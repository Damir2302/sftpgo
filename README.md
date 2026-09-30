# SFTPGo Mass Provisioning Script

Node.js-скрипт для массового создания и обновления SFTP-бэкендов и пользователей в SFTPGo через REST API.

Скрипт умеет:

- создавать или обновлять виртуальные папки SFTPGo;
- создавать или обновлять пользователей SFTPGo;
- привязывать пользователям виртуальные папки;
- проверять доступность SFTP-хостингов по SSH/SFTP;
- работать в режиме `upsert`: если объект уже существует - обновляет его, если нет - создаёт.

---

## Структура проекта

```text
.
├── sftpgo.js
├── config.example.jsonc
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

Назначение файлов:

| Файл | Описание |
|---|---|
| `sftpgo.js` | Основной скрипт |
| `config.example.jsonc` | Пример списка хостингов и пользователей |
| `config.jsonc` | Список SFTP-хостингов и пользователей, не должен попадать в Git |
| `.env.example` | Пример переменных окружения |
| `.env` | Локальный файл с реальными доступами, не должен попадать в Git |
| `.gitignore` | Исключает `.env` и `node_modules` |
| `package.json` | Зависимости и npm-команды |

---

## Требования

Перед использованием должны быть установлены:

- Node.js 18+;
- npm;
- доступ к SFTPGo API;
- учётная запись администратора SFTPGo.

Установить зависимости:

```bash
npm install
```

Используемые пакеты:

- `dotenv` — загрузка переменных окружения из `.env`;
- `ssh2` — проверка доступности внешних SFTP-хостингов.

---

## Настройка `.env`

Создайте `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

Заполните реальные значения:

```env
SFTPGO_URL=https://sftpgo.example.com
SFTPGO_USERNAME=admin
SFTPGO_PASSWORD=admin_password

CONFIG_PATH=./config.jsonc
SFTP_CHECK_TIMEOUT_MS=8000
```

Описание переменных:

| Переменная | Обязательная | Описание |
|---|---:|---|
| `SFTPGO_URL` | Да | URL SFTPGo без завершающего `/` |
| `SFTPGO_USERNAME` | Да | Администратор SFTPGo |
| `SFTPGO_PASSWORD` | Да | Пароль администратора SFTPGo |
| `CONFIG_PATH` | Нет | Путь к JSON-конфигу. По умолчанию `./config.jsonc` |
| `SFTP_CHECK_TIMEOUT_MS` | Нет | Таймаут проверки SFTP-подключения. По умолчанию `8000` |

---

## Настройка `config.jsonc`

Файл `config.jsonc` содержит два массива:

```json
{
  "sites": [],
  "users": []
}
```

- `sites` — внешние SFTP-хостинги, которые нужно добавить в SFTPGo как виртуальные папки;
- `users` — пользователи SFTPGo и список папок, которые нужно им подключить.

---

## Пример `config.jsonc`

```json
{
  "sites": [
    {
      "name": "site-1",
      "remote_path": "/site-1",
      "endpoint": "sftp.example.com:22",
      "sftp_user": "remote_user",
      "sftp_pass": "remote_password",
      "sftp_path": "/public_html"
    }
  ],
  "users": [
    {
      "username": "client1",
      "password": "strong_password",
      "folders": [
        {
          "name": "site-1",
          "virtual_path": "/site-1"
        }
      ]
    }
  ]
}
```

---

## Структура `sites`

Описание полей внутри `sites`:

| Поле | Описание |
|---|---|
| `name` | Имя виртуальной папки в SFTPGo |
| `remote_path` | Локальный mapped path для папки в SFTPGo |
| `endpoint` | Адрес SFTP-сервера в формате `host:port` |
| `sftp_user` | Пользователь внешнего SFTP-сервера |
| `sftp_pass` | Пароль внешнего SFTP-сервера |
| `sftp_path` | Путь на внешнем SFTP-сервере, который будет использоваться как корень |

Пример:

```json
{
  "name": "site-1",
  "remote_path": "/site-1",
  "endpoint": "sftp.example.com:22",
  "sftp_user": "remote_user",
  "sftp_pass": "remote_password",
  "sftp_path": "/public_html"
}
```

---

## Структура `users`

Описание полей внутри `users`:

| Поле | Описание |
|---|---|
| `username` | Логин пользователя SFTPGo |
| `password` | Пароль пользователя SFTPGo |
| `home_dir` | Необязательное поле. Если не указано, используется `/srv/sftpgo/data/<username>` |
| `permissions` | Необязательное поле. Если не указано, пользователь получает `"/": ["*"]` |
| `folders` | Список виртуальных папок пользователя |
| `folders[].name` | Имя виртуальной папки из `sites` |
| `folders[].virtual_path` | Путь, по которому папка будет видна пользователю |
| `folders[].quota_size` | Необязательное поле. По умолчанию `-1` |
| `folders[].quota_files` | Необязательное поле. По умолчанию `-1` |

Пример:

```json
{
  "username": "client1",
  "password": "strong_password",
  "folders": [
    {
      "name": "site-1",
      "virtual_path": "/site-1"
    }
  ]
}
```

Пример с кастомными правами:

```json
{
  "username": "readonly-client",
  "password": "strong_password",
  "permissions": {
    "/": ["list", "download"]
  },
  "folders": [
    {
      "name": "site-1",
      "virtual_path": "/site-1"
    }
  ]
}
```

---

## Команды запуска

Можно запускать напрямую через Node.js:

```bash
node sftpgo.js check
node sftpgo.js domains
node sftpgo.js users
```

Или через npm scripts:

```bash
npm run check
npm run domains
npm run users
```

---

## Проверить доступность SFTP-хостингов

```bash
npm run check
```

Что делает команда:

1. Читает массив `sites` из `config.jsonc`.
2. Подключается к каждому `endpoint` по SFTP.
3. Проверяет логин и пароль.
4. Выводит список успешных и неуспешных подключений.

---

## Создать или обновить виртуальные папки

```bash
npm run domains
```

Что делает команда:

1. Получает access token через API SFTPGo.
2. Читает массив `sites` из `config.jsonc`.
3. Проверяет, существует ли папка в SFTPGo.
4. Если папка существует — обновляет её через `PUT`.
5. Если папки нет — создаёт её через `POST`.

---

## Создать или обновить пользователей

```bash
npm run users
```

Что делает команда:

1. Получает access token через API SFTPGo.
2. Читает массив `users` из `config.jsonc`.
3. Проверяет, существует ли пользователь в SFTPGo.
4. Если пользователь существует — обновляет его через `PUT`.
5. Если пользователя нет — создаёт его через `POST`.
6. Назначает пользователю виртуальные папки из поля `folders`.

---

## Рекомендуемый порядок запуска

```bash
npm run check
npm run domains
npm run users
```

Сначала лучше проверить доступность внешних SFTP-хостингов, затем создать виртуальные папки и только после этого создавать пользователей.

---

## Логика upsert

Скрипт использует общий метод `upsert`.

Принцип работы:

- сначала выполняется `GET`-запрос для проверки существования объекта;
- если API возвращает `404`, объект считается отсутствующим;
- если объект найден, используется `PUT`;
- если объект не найден, используется `POST`.

Это позволяет запускать скрипт повторно без ручного удаления уже созданных объектов.

---

## Безопасность

Файл `.env` содержит доступы администратора SFTPGo и не должен попадать в Git.

---

## Возможные ошибки

### `Не задана переменная окружения`

Причина: в `.env` не указаны обязательные переменные.

Проверьте:

```env
SFTPGO_URL=
SFTPGO_USERNAME=
SFTPGO_PASSWORD=
```

---

### `Файл конфигурации не найден`

Причина: файл `config.jsonc` отсутствует или указан неправильный `CONFIG_PATH`.

Проверьте путь:

```env
CONFIG_PATH=./config.jsonc
```

---

### Ошибка авторизации в SFTPGo

Возможные причины:

- неверный `SFTPGO_USERNAME`;
- неверный `SFTPGO_PASSWORD`;
- неверный `SFTPGO_URL`;
- пользователь не имеет прав администратора.

---

### `404` при проверке объекта

Это нормальное поведение. Скрипт воспринимает `404` как признак того, что папка или пользователь ещё не существуют.

---

### Ошибка подключения к SFTP-сайту

Возможные причины:

- неверный host или port;
- неверный логин;
- неверный пароль;
- сервер недоступен;
- подключение заблокировано firewall;
- SFTP-сервер не принимает password-auth.

---