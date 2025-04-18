# 币安价格监控 Telegram 机器人

这是一个基于 Node.js 的 Telegram 机器人，用于监控币安交易所的加密货币价格。

## 功能特点

- 实时价格监控
- 价格变动提醒（30分钟内变化超过5%）
- 新代币上线提醒
- 交易量排名更新（每24小时）
- BTC每日分析
- AI智能分析
- 自动重连机制

## VPS部署教程

### 1. 服务器要求
- 操作系统：Ubuntu 20.04 LTS 或更高版本
- 内存：至少1GB RAM
- 存储：至少20GB SSD
- 带宽：稳定的网络连接

### 2. 环境准备
```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装Node.js和npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 安装Git
sudo apt install -y git

# 安装screen
sudo apt install -y screen
```

### 3. 部署步骤
```bash
# 1. 克隆项目
git clone https://github.com/mumumusf/tgyoyom.git
cd tgyoyom

# 2. 安装依赖
npm install

# 3. 创建并编辑环境配置文件
# 使用nano编辑器创建.env文件
nano .env

# 4. 在打开的编辑器中粘贴以下内容（替换相应的值）：
TELEGRAM_BOT_TOKEN=你的机器人token
TELEGRAM_CHANNEL_ID=你的频道ID
BINANCE_REST_API=https://api.binance.com/api/v3
BINANCE_WS_ENDPOINT=wss://stream.binance.com:9443/ws
DEEPSEEK_API_KEY=你的DeepSeek API密钥
DEEPSEEK_API_URL=https://api.deepseek.com/v1/chat/completions
PRICE_CHANGE_THRESHOLD=1.0

# 5. 保存文件
# 按 Ctrl + X，然后按 Y，最后按 Enter

# 6. 设置文件权限
chmod 600 .env

# 7. 验证环境变量是否正确加载
node -e "require('dotenv').config(); console.log('BINANCE_WS_ENDPOINT:', process.env.BINANCE_WS_ENDPOINT)"

# 8. 创建screen会话并启动服务
screen -S crypto-bot
node index.js

# 9. 分离screen会话
# 按 Ctrl + A，然后按 D
```

### 4. 验证部署
```bash
# 1. 检查screen会话是否在运行
screen -ls

# 2. 查看运行日志
screen -r crypto-bot

# 3. 检查环境变量
node -e "require('dotenv').config(); console.log(process.env)"
```

### 5. 常见问题解决

#### 5.1 环境变量未加载
如果遇到 "Invalid URL: undefined" 错误：
```bash
# 1. 检查.env文件是否存在
ls -la .env

# 2. 检查文件权限
chmod 600 .env

# 3. 验证环境变量
node -e "require('dotenv').config(); console.log(process.env.BINANCE_WS_ENDPOINT)"

# 4. 如果环境变量未正确加载，尝试重新创建.env文件
rm .env
nano .env
# 重新粘贴配置内容
```

#### 5.2 服务无法启动
```bash
# 1. 检查Node.js版本
node -v

# 2. 检查依赖是否正确安装
npm install

# 3. 检查日志
screen -r crypto-bot
```

#### 5.3 自动重启脚本
创建 `restart.sh`：
```bash
#!/bin/bash
screen -X -S crypto-bot quit
screen -dmS crypto-bot
screen -S crypto-bot -X stuff "cd /home/ubuntu/tgyoyom && node index.js$(echo -e '\015')"
chmod +x restart.sh
```

## 新手使用教程

### 1. 加入频道
1. 打开 Telegram
2. 搜索频道：[@yoyozksu](https://t.me/yoyozksu)
3. 点击"加入频道"
4. 关注我们的Twitter：[@YOYOMYOYOA](https://x.com/YOYOMYOYOA)

### 2. 机器人功能说明

#### 2.1 价格监控
- 自动监控交易量前50的代币
- 重点监控前10个代币
- 当价格在30分钟内变化超过5%时发送提醒
- 提醒包含AI分析和投资建议

#### 2.2 新代币提醒
- 每5分钟检查一次新上线的代币
- 显示新代币的价格、24小时变化和成交量

#### 2.3 交易量排名
- 每24小时更新一次交易量排名
- 显示前50个代币的排名
- 重点标记前10个代币

#### 2.4 BTC每日分析
- 每天自动分析BTC市场情况
- 包含价格、成交量、市场情绪等分析
- 提供AI投资建议

### 3. 机器人命令

在频道中，您可以使用以下命令：

- `/start` - 开始使用机器人
- `/subscribe` - 订阅价格提醒
- `/unsubscribe` - 取消订阅
- `/price <币种>` - 查询指定币种价格（例如：/price BTC）
- `/top` - 查看涨幅榜
- `/bottom` - 查看跌幅榜
- `/help` - 显示帮助信息

### 4. 提醒类型说明

#### 4.1 价格突变提醒
```
📈 BTCUSDT 价格上涨提醒 📈

交易对: BTCUSDT
当前价格: 50000.00 USDT
短期变化: +5.20%

AI分析:
[详细的市场分析和投资建议]

时间: 2024-01-01 12:00:00
```

#### 4.2 新代币提醒
```
🆕 新代币上线提醒 🆕

发现 1 个新上线的代币：

1. NEWTOKENUSDT
   • 当前价格: 1.00000000 USDT
   • 24小时变化: +0.00% (上涨) 📈
   • 24小时成交量: 1000.00 NEWTOKEN

时间: 2024-01-01 12:00:00
```

#### 4.3 交易量排名更新
```
📊 交易量排名更新 📊

交易量前 50 的代币：

🔥 1. BTCUSDT (重点监控)
🔥 2. ETHUSDT (重点监控)
• 3. BNBUSDT
...

重点监控的代币：
• 交易量前 10 的代币将获得更详细的AI分析
• 价格变动超过 5% 时会收到突然上涨/下跌提醒（含AI分析）
• 10分钟后会收到AI跟进分析，评估之前的投资建议

更新时间: 2024-01-01 12:00:00
```

### 5. 注意事项

1. 所有提醒都会在频道中发送
2. 价格提醒包含AI分析，帮助您做出投资决策
3. 新代币提醒可以帮助您发现投资机会
4. 交易量排名更新可以帮助您了解市场热点
5. BTC每日分析可以帮助您把握市场整体趋势

### 6. 常见问题

Q: 为什么没有收到价格提醒？
A: 只有当价格在30分钟内变化超过5%时才会发送提醒。

Q: 如何查询某个币种的价格？
A: 使用命令 `/price 币种名称`，例如：`/price BTC`

Q: 如何查看涨幅最大的代币？
A: 使用命令 `/top` 查看涨幅榜

Q: 如何查看跌幅最大的代币？
A: 使用命令 `/bottom` 查看跌幅榜

## 技术栈

- Node.js
- node-telegram-bot-api
- ws (WebSocket)
- axios
- dotenv

## 免责声明

本机器人提供的所有信息仅供参考，不构成投资建议。加密货币市场风险较大，请谨慎投资。 