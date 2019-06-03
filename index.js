
const Redis = require('ioredis');
const parser = require('cron-parser');
const moment = require('moment');

let client
let PubSub

// 前缀
const PREFIX = '__job__';
// job hash
const JOBNAMEHASH = '__jobname__';
// 已注册的job
const REGISTERHANDLER = {};


RedisSchedule = function (option) {
    let config = option || {
        host: "127.0.0.1",
        port: 6379
    };
    client = new Redis(config);
    PubSub = new Redis(config);

    PubSub.config("SET", "notify-keyspace-events", "Ex");
    PubSub.subscribe(`__keyevent@${config.db}__:expired`);
    PubSub.on("message", async (channel, key) => {
        // Handle event
        let keydetail = key.split(':');
        if (keydetail.length >= 2) {
            if (keydetail[0] != PREFIX) {
                return;
            }
            let jobHandler = REGISTERHANDLER[key];
            if (typeof jobHandler === 'function') {
                // 加锁
                let lockKey = 'LOCK:' + key;
                let ok = await client.setnx(lockKey, '1');
                if (ok) {
                    try {
                        let metedata = await client.hget(JOBNAMEHASH, key);
                        if (metedata) {
                            metedata = JSON.parse(metedata);
                            let ncron = getNextCron(metedata.cron);
                            if (ncron.ttl > 0) {
                                metedata.nextTime = ncron.nextTime;
                                await Promise.all([
                                    client.hset(JOBNAMEHASH, key, JSON.stringify(metedata)),
                                    setKeyExpire(key, '1', ncron.ttl)
                                ])
                                // 调用回调函数
                                await jobHandler.call();
                            } else {
                                // 没有下一次了
                                await delJob(key);
                            }
                        } else {
                            console.log(`can not get job ${jobname} metadate`);
                        }
                    } catch (ex) {
                        // do nothing
                        console.log(` job ${jobname} call back error ${ex}`);
                    }
                    // 删除锁
                    await client.del(lockKey);
                }
            }
        }
    });
}

// 删除任务
delJob = async function (key) {
    delete REGISTERHANDLER[key];
    await client.del(key);
    await client.hdel(JOBNAMEHASH, key);
}

// 获取下一次执行时的信息
getNextCron = function (timecron) {
    let interval = parser.parseExpression(timecron);
    let res = {
        ttl: -1,
        nextTime: 0
    };
    if (interval.hasNext()) {
        // 获取距离下次执行的时间间隔
        res.nextTime = parseInt(interval.next().getTime() / 1000);
        res.ttl = res.nextTime - parseInt(new Date().getTime() / 1000);
    }
    return res;
}

// 设置key过期时间
setKeyExpire = async function (key, value, ttl) {
    if (ttl > 0) {
        await client.set(key, value, 'NX', 'EX', ttl);
    }
}

// 根据jobname 获取key
getKeyByJob = function (jobname) {
    return PREFIX + ':' + jobname;
}

// 注册定时器
RedisSchedule.prototype.register = async function (timecron, jobname) {
    if (typeof timecron !== "string" || typeof jobname !== 'string') {
        throw new Error('params error');
    }
    let key = getKeyByJob(jobname);
    if (!REGISTERHANDLER[key]) {
        throw new Error(`job ${jobname} undefined`);
    }
    let nextcron = getNextCron(timecron);
    if (nextcron.ttl > 0) {
        let meta = {
            cron: timecron,
            createTime: moment().unix(),
            nextTime: nextcron.nextTime
        }
        // 设置定时器元数据
        let exists = await client.hexists(JOBNAMEHASH, key);
        if (!exists) {
            await client.hset(JOBNAMEHASH, key, JSON.stringify(meta));
        }
        // 设置过期时间
        await setKeyExpire(key, '1', nextcron.ttl);
    }
    console.log(`register the job: ${jobname}`);
}

// 定义任务,jobname要唯一
RedisSchedule.prototype.defined = async function (jobname, handler) {
    if (typeof jobname !== "string" || typeof handler !== 'function') {
        throw new Error('params error');
    }
    let key = getKeyByJob(jobname);
    if (REGISTERHANDLER[key]) {
        throw new Error(`the job [${jobname}] is exist`);
    }
    REGISTERHANDLER[key] = handler;
    console.log(`defined the job: ${jobname}`);
}

// 取消任务
RedisSchedule.prototype.cancel = async function (jobname) {
    if (typeof jobname !== "string") {
        throw new Error('params error');
    }
    // 删除相关数据
    let key = getKeyByJob(jobname);
    await delJob(key);
    console.log(`cancel the job: ${jobname}`);
}

module.exports = RedisSchedule;