require('dotenv').config();

const fs = require('fs');
const { Client } = require('ssh2');
const { parse } = require('jsonc-parser');

const SFTPGO_URL = process.env.SFTPGO_URL;
const USERNAME = process.env.SFTPGO_USERNAME;
const PASSWORD = process.env.SFTPGO_PASSWORD;

const CONFIG_PATH = process.env.CONFIG_PATH;
const TIMEOUT_MS = Number(process.env.SFTP_CHECK_TIMEOUT_MS || 8000);

function requireEnv(name, value) {
    if (!value) {
        throw new Error(`Не задана переменная окружения: ${name}`);
    }
}

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        throw new Error(`Файл конфигурации не найден: ${CONFIG_PATH}`);
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const errors = [];
    const config = parse(raw, errors, {
        allowTrailingComma: true
    });

    if (errors.length > 0) {
        throw new Error(`Ошибка парсинга JSONC в файле ${CONFIG_PATH}: ${JSON.stringify(errors)}`);
    }

    return {
        sites: Array.isArray(config.sites) ? config.sites : [],
        users: Array.isArray(config.users) ? config.users : []
    };
}

async function getToken() {
    requireEnv('SFTPGO_URL', SFTPGO_URL);
    requireEnv('SFTPGO_USERNAME', USERNAME);
    requireEnv('SFTPGO_PASSWORD', PASSWORD);

    const authRes = await fetch(`${SFTPGO_URL}/api/v2/token`, {
        method: 'GET',
        headers: {
            Authorization: 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')
        }
    });

    if (!authRes.ok) {
        const errorMsg = await authRes.text();
        console.error('Ошибка авторизации в SFTPGo:', errorMsg);
        return null;
    }

    const { access_token } = await authRes.json();
    return access_token;
}

async function exists(url, token) {
    const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 404) return false;
    if (res.ok) return true;

    const errorMsg = await res.text();
    throw new Error(`Не удалось проверить ${url}: ${res.status} ${errorMsg}`);
}

async function upsert(baseUrl, checkUrl, payload, token, label) {
    try {
        const already = await exists(checkUrl, token);
        const method = already ? 'PUT' : 'POST';
        const url = already ? checkUrl : baseUrl;

        const res = await fetch(url, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            console.log(`${already ? 'Обновлено' : 'Создано'}: ${label}`);
        } else {
            const errorMsg = await res.text();
            console.error(`Ошибка (${label}):`, errorMsg);
        }
    } catch (err) {
        console.error(`Ошибка (${label}):`, err.message);
    }
}

async function massCreateSFTPFolders() {
    const { sites } = loadConfig();
    const access_token = await getToken();

    if (!access_token) return;

    for (const site of sites) {
        const payload = {
            name: site.name,
            mapped_path: site.remote_path,
            description: `SFTP backend for ${site.name}`,
            filesystem: {
                provider: 5,
                sftpconfig: {
                    endpoint: site.endpoint,
                    username: site.sftp_user,
                    password: {
                        status: 'Plain',
                        payload: site.sftp_pass
                    },
                    prefix: site.sftp_path,
                    strict_host_key_checking: false
                }
            }
        };

        await upsert(
            `${SFTPGO_URL}/api/v2/folders`,
            `${SFTPGO_URL}/api/v2/folders/${encodeURIComponent(site.name)}`,
            payload,
            access_token,
            site.name
        );
    }
}

async function massCreateUsers() {
    const { users } = loadConfig();
    const access_token = await getToken();

    if (!access_token) return;

    for (const user of users) {
        const payload = {
            status: 1,
            username: user.username,
            password: user.password,
            home_dir: user.home_dir || `/srv/sftpgo/data/${user.username}`,
            permissions: user.permissions || {
                "/": ["*"]
            },
            virtual_folders: user.folders.map(folder => ({
                name: folder.name,
                virtual_path: folder.virtual_path,
                quota_size: folder.quota_size ?? -1,
                quota_files: folder.quota_files ?? -1
            }))
        };

        await upsert(
            `${SFTPGO_URL}/api/v2/users`,
            `${SFTPGO_URL}/api/v2/users/${encodeURIComponent(user.username)}`,
            payload,
            access_token,
            user.username
        );
    }
}

async function checkSites() {
    const { sites } = loadConfig();

    function checkOne(site) {
        return new Promise((resolve) => {
            const [host, portStr] = site.endpoint.split(':');
            const port = Number(portStr) || 22;
            const conn = new Client();

            const timer = setTimeout(() => {
                conn.end();
                resolve({ name: site.name, ok: false, error: `timeout after ${TIMEOUT_MS}ms` });
            }, TIMEOUT_MS);

            conn
                .on('ready', () => {
                    clearTimeout(timer);
                    conn.end();
                    resolve({ name: site.name, ok: true });
                })
                .on('error', (err) => {
                    clearTimeout(timer);
                    resolve({ name: site.name, ok: false, error: err.message });
                })
                .connect({
                    host,
                    port,
                    username: site.sftp_user,
                    password: site.sftp_pass,
                    readyTimeout: TIMEOUT_MS
                });
        });
    }

    console.log(`Проверка ${sites.length} сайт(ов)...\n`);
    const results = await Promise.all(sites.map(checkOne));

    const failedResults = results.filter((result) => !result.ok);
    const successfulResults = results.filter((result) => result.ok);

    for (const result of successfulResults) {
        console.log(`OK    ${result.name}`);
    }

    for (const result of failedResults) {
        console.log(`FAIL  ${result.name} — ${result.error}`);
    }

    console.log(`\nИтого: ${successfulResults.length} ок, ${failedResults.length} недоступно.`);

    if (failedResults.length > 0) {
        const failedSiteNames = failedResults.map((result) => result.name);

        console.log('Проблемные сайты:', failedSiteNames.join(', '));
    }
}

async function main() {
    const command = process.argv[2];

    switch (command) {
        case 'domains':
            await massCreateSFTPFolders();
            break;
        case 'users':
            await massCreateUsers();
            break;
        case 'check':
            await checkSites();
            break;
        default:
            console.log('Укажите функцию для запуска: domains | users | check');
    }
}

main().catch((err) => {
    console.error('Критическая ошибка:', err.message);
    process.exit(1);
});

// $env:NODE_TLS_REJECT_UNAUTHORIZED="0"; - это надо в консоль ввести, чтобы не ругался на сертификат