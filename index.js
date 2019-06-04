
const Redis = require('ioredis');
const parser = require('cron-parser');
const moment = require('moment');

let client
let PubSub

// 前缀
const PREFIX = '__job__';
const JOBDONE = '__jobdone__';
// job hash
const JOBDETAILHASH = '__jobdetail__';
// 已注册的job
const REGISTERHANDLER = {};


RedisSchedule = function (option) {
    this.config = option || {
        host: "127.0.0.1",
        port: 6379
    };
    client = new Redis(this.config);
    PubSub = new Redis(this.config);
}

// 删除任务
delJob = async function (key) {
    delete REGISTERHANDLER[key];
    await client.del(key);
    await client.hdel(JOBDETAILHASH, key);
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
        res.ttl = res.nextTime - moment().unix();
    }
    return res;
}

// 设置key过期时间
setKeyExpire = async function (key, value, ttl, force = true) {
    if (ttl > 0) {
        if (force) {
            await client.set(key, value, 'EX', ttl);
        } else {
            await client.set(key, value, 'NX', 'EX', ttl);
        }
    }
}

// 注册定时器
RedisSchedule.prototype.register = async function (timecron, jobname) {
    if (typeof timecron !== "string" || typeof jobname !== 'string') {
        throw new Error('params error');
    }
    let key = this.getKeyByJob(jobname);
    if (!REGISTERHANDLER[key]) {
        throw new Error(`job ${jobname} undefined`);
    }
    let nextcron = getNextCron(timecron);
    if (nextcron.ttl > 0) {
        let meta = {
            cron: timecron,
            createTime: moment().unix(),
            nextTime: nextcron.nextTime,
            group: this.groupName
        }
        // 设置定时器元数据
        let oldmeta = await client.hget(JOBDETAILHASH, key);
        if (oldmeta) {
            oldmeta = JSON.parse(oldmeta);
            let now = moment().unix();
            let needUpdate = false;
            if (oldmeta.cron != meta.cron) {
                needUpdate = true;
            } else if (oldmeta.nextTime < now) {
                needUpdate = true;
            }
            if (needUpdate) {
                // 设置job详情 和 过期时间
                await client.hset(JOBDETAILHASH, key, JSON.stringify(meta));
                await setKeyExpire(key, '1', nextcron.ttl, true);
            }
        } else {
            // 设置job详情 和 过期时间
            await client.hset(JOBDETAILHASH, key, JSON.stringify(meta));
            await setKeyExpire(key, '1', nextcron.ttl, true);
        }
    }
    console.log(`register the job: ${jobname}`);
}

// 同一个组只有一个实例收到消息
RedisSchedule.prototype.setGroupName = async function (groupName) {
    if (!groupName) {
        throw new Error('please set a correct groupName');
    }
    this.groupName = groupName;
}

// 根据jobname 获取key
RedisSchedule.prototype.getKeyByJob = function (jobname) {
    return PREFIX + ':' + this.groupName + ":" + jobname;
}

// 定义任务,jobname要唯一
RedisSchedule.prototype.defined = async function (jobname, handler) {
    if (typeof jobname !== "string" || typeof handler !== 'function') {
        throw new Error('params error');
    }
    if (!this.groupName) {
        throw new Error(`please set the groupName first`);
    }
    let key = this.getKeyByJob(jobname);
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
    let key = this.getKeyByJob(jobname);
    await delJob(key);
    console.log(`cancel the job: ${jobname}`);
}

// 获取job已执行的key
RedisSchedule.prototype.getJobDoneKey = function (jobname, jobTime) {
    return JOBDONE + ":" + this.groupName + ":" + jobname + ":" + moment.unix(jobTime).format('YYYYMMDDHHmmss');
}

// 启动
RedisSchedule.prototype.start = async function () {

    PubSub.config("SET", "notify-keyspace-events", "Ex");
    PubSub.subscribe(`__keyevent@${this.config.db}__:expired`);
    let self = this;
    PubSub.on("message", async (channel, key) => {
        // Handle event
        let keydetail = key.split(':');
        if (keydetail.length >= 3) {
            if (keydetail[0] != PREFIX || self.groupName != keydetail[1]) {
                return;
            }
            // 获取真正的jobname
            let jobname = key.substr(PREFIX.length + self.groupName.length + 2);
            let jobHandler = REGISTERHANDLER[key];
            if (typeof jobHandler === 'function') {
                // 设置下一次的值行时间
                let metedata = await client.hget(JOBDETAILHASH, key);
                if (metedata) {
                    metedata = JSON.parse(metedata);
                    let now = moment().unix();
                    let jobTime = metedata.nextTime;
                    if (now >= jobTime) {
                        let ncron = getNextCron(metedata.cron);
                        let lockKey = self.getJobDoneKey(jobname, jobTime);
                        let ttl = ncron.ttl > 300 ? ncron.ttl : 300;
                        let ok = await client.set(lockKey, '1', 'NX', 'EX', ttl);
                        if (ok) {
                            // 更新job detail
                            if (ncron.ttl > 0) {
                                metedata.nextTime = ncron.nextTime;
                                await Promise.all([
                                    client.hset(JOBDETAILHASH, key, JSON.stringify(metedata)),
                                    setKeyExpire(key, '1', ncron.ttl)
                                ])
                            } else {
                                // 定时器结束
                                await delJob(key);
                            }

                            // 调用回调函数
                            try {
                                await jobHandler.call();
                            } catch (ex) {
                                // do nothing
                                console.log(`the job [${jobname}] call back error ${ex}`);
                            }
                        }
                    }
                } else {
                    console.log(`can not get the job [${jobname}] metadate`);
                }
            }
        }
    });
}

module.exports = RedisSchedule;