// 预览.js — 开发时起一份终端，**不占 4280**。
//
// 4280 是部署区那个常驻 exe 的窝（开机自启、整天在跑）。开发时抢它的端口有两个坏处：
// 一是把制作人正在用的那块屏挤掉，二是 server.js 端口被占会顺延，
// 于是「launch.json 写的端口」和「实际监听的端口」对不上，预览面板连的是个空地址。
// 所以这里显式钉死另一个端口。
process.env.NO_INTEL = process.env.NO_INTEL || '1';   // 预览不抓情报，省得开发时反复走网络
require('../server.js').start(Number(process.env.PORT || 4399));
