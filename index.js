require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const axios = require('axios');

// 初始化 Telegram 机器人
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// 存储用户订阅的交易对
const userSubscriptions = new Map();

// 存储所有交易对的价格信息
const allSymbolsData = new Map();

// 电报频道ID
const TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

// 价格变动阈值（百分比）
const PRICE_CHANGE_THRESHOLD = 2.0;

// 短期价格变动阈值（百分比）- 用于检测突然上涨或下跌
const SHORT_TERM_PRICE_CHANGE_THRESHOLD = 5.0; // 30分钟内价格变化阈值

// 监控的交易对数量
const TOP_SYMBOLS_COUNT = 50; // 监控前50个交易对

// 重点监控的交易对数量
const FOCUS_SYMBOLS_COUNT = 10; // 重点监控前10个交易对

// 代币上新检查间隔（毫秒）
const NEW_TOKEN_CHECK_INTERVAL = 5 * 60 * 1000; // 5分钟

// 交易量更新间隔（毫秒）
const VOLUME_UPDATE_INTERVAL = 24 * 60 * 60 * 1000; // 24小时

// AI跟进分析间隔（毫秒）
const AI_FOLLOW_UP_INTERVAL = 10 * 60 * 1000; // 10分钟

// BTC每日分析间隔（毫秒）
const BTC_DAILY_ANALYSIS_INTERVAL = 24 * 60 * 60 * 1000; // 24小时

// DeepSeek API 配置
const DEEPSEEK_API_KEY = 'sk-0b66b55ed92e4b4da3a477c58db57c2d';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// WebSocket 连接管理
class BinanceWebSocket {
    constructor() {
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.subscriptions = new Set();
        this.priceHistory = new Map(); // 存储价格历史
        this.topSymbols = new Set(); // 存储交易量前50的交易对
        this.focusSymbols = new Set(); // 存储交易量前10的交易对
        this.knownSymbols = new Set(); // 存储已知的交易对
        this.newTokenCheckInterval = null; // 新代币检查定时器
        this.volumeUpdateInterval = null; // 交易量更新定时器
        this.aiAnalysisHistory = new Map(); // 存储AI分析历史
        this.aiFollowUpTimers = new Map(); // 存储AI跟进分析定时器
        this.btcDailyAnalysisTimer = null; // BTC每日分析定时器
        this.btcAnalysisHistory = []; // 存储BTC分析历史
    }

    connect() {
        this.ws = new WebSocket(process.env.BINANCE_WS_ENDPOINT);

        this.ws.on('open', () => {
            console.log('WebSocket连接成功');
            this.reconnectAttempts = 0;
            this.subscribeToAllSymbols();
            this.startNewTokenCheck();
            this.startVolumeUpdate();
            this.startBTCDailyAnalysis();
        });

        this.ws.on('message', (data) => {
            const message = JSON.parse(data);
            this.handleMessage(message);
        });

        this.ws.on('close', () => {
            console.log('WebSocket连接断开');
            this.reconnect();
            this.stopNewTokenCheck();
            this.stopVolumeUpdate();
            this.stopBTCDailyAnalysis();
        });

        this.ws.on('error', (error) => {
            console.error('WebSocket错误:', error);
            this.reconnect();
            this.stopNewTokenCheck();
            this.stopVolumeUpdate();
            this.stopBTCDailyAnalysis();
        });
    }

    reconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            console.log(`正在重新连接... 尝试 ${this.reconnectAttempts}`);
            setTimeout(() => this.connect(), 5000 * this.reconnectAttempts);
        }
    }

    startNewTokenCheck() {
        // 清除可能存在的旧定时器
        this.stopNewTokenCheck();
        
        // 设置新的定时器，定期检查新代币
        this.newTokenCheckInterval = setInterval(() => {
            this.checkForNewTokens();
        }, NEW_TOKEN_CHECK_INTERVAL);
        
        console.log(`已启动新代币检查 (间隔: ${NEW_TOKEN_CHECK_INTERVAL / 60000} 分钟)`);
    }
    
    stopNewTokenCheck() {
        if (this.newTokenCheckInterval) {
            clearInterval(this.newTokenCheckInterval);
            this.newTokenCheckInterval = null;
            console.log('已停止新代币检查');
        }
    }
    
    startVolumeUpdate() {
        // 清除可能存在的旧定时器
        this.stopVolumeUpdate();
        
        // 设置新的定时器，每天更新交易量排名
        this.volumeUpdateInterval = setInterval(() => {
            this.updateTopSymbols();
        }, VOLUME_UPDATE_INTERVAL);
        
        console.log(`已启动交易量更新 (间隔: ${VOLUME_UPDATE_INTERVAL / (60 * 60 * 1000)} 小时)`);
    }
    
    stopVolumeUpdate() {
        if (this.volumeUpdateInterval) {
            clearInterval(this.volumeUpdateInterval);
            this.volumeUpdateInterval = null;
            console.log('已停止交易量更新');
        }
    }
    
    async updateTopSymbols() {
        try {
            console.log('正在更新交易量排名...');
            
            // 获取24小时交易量数据，找出交易量前50的交易对
            const volumeResponse = await axios.get(`${process.env.BINANCE_REST_API}/ticker/24hr`);
            const topSymbols = volumeResponse.data
                .filter(item => item.symbol.endsWith('USDT'))
                .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume))
                .slice(0, TOP_SYMBOLS_COUNT)
                .map(item => item.symbol);
            
            // 更新交易量前50的交易对
            this.topSymbols = new Set(topSymbols);
            console.log(`已更新交易量前 ${topSymbols.length} 个USDT交易对`);
            
            // 更新交易量前10的交易对
            const focusSymbols = topSymbols.slice(0, FOCUS_SYMBOLS_COUNT);
            this.focusSymbols = new Set(focusSymbols);
            console.log(`已更新重点监控的 ${focusSymbols.length} 个USDT交易对`);
            
            // 发送更新通知
            this.notifyVolumeUpdate(topSymbols, focusSymbols);
        } catch (error) {
            console.error('更新交易量排名时出错:', error);
        }
    }
    
    async notifyVolumeUpdate(topSymbols, focusSymbols) {
        // 构建消息
        let message = `📊 *交易量排名更新* 📊\n\n`;
        message += `*交易量前 ${TOP_SYMBOLS_COUNT} 的代币：*\n\n`;
        
        topSymbols.forEach((symbol, index) => {
            const isFocus = index < FOCUS_SYMBOLS_COUNT;
            const prefix = isFocus ? '🔥' : '•';
            message += `${prefix} ${index + 1}. *${symbol}*${isFocus ? ' (重点监控)' : ''}\n`;
        });
        
        message += `\n*重点监控的代币：*\n`;
        message += `• 交易量前 ${FOCUS_SYMBOLS_COUNT} 的代币将获得更详细的AI分析\n`;
        message += `• 价格变动超过 ${SHORT_TERM_PRICE_CHANGE_THRESHOLD}% 时会收到突然上涨/下跌提醒（含AI分析）\n`;
        message += `• 10分钟后会收到AI跟进分析，评估之前的投资建议\n\n`;
        
        message += `_更新时间: ${new Date().toLocaleString()}_`;
        
        // 只发送到电报频道
        bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { parse_mode: 'Markdown' });
    }
    
    async checkForNewTokens() {
        try {
            console.log('正在检查新代币...');
            
            // 获取所有交易对信息
            const response = await axios.get(`${process.env.BINANCE_REST_API}/exchangeInfo`);
            const currentSymbols = new Set(
                response.data.symbols
                    .filter(symbol => symbol.quoteAsset === 'USDT' && symbol.status === 'TRADING')
                    .map(symbol => symbol.symbol)
            );
            
            // 找出新上线的交易对
            const newSymbols = [];
            for (const symbol of currentSymbols) {
                if (!this.knownSymbols.has(symbol)) {
                    newSymbols.push(symbol);
                    this.knownSymbols.add(symbol);
                }
            }
            
            // 如果有新上线的交易对，发送提醒
            if (newSymbols.length > 0) {
                console.log(`发现 ${newSymbols.length} 个新代币: ${newSymbols.join(', ')}`);
                this.notifyNewTokens(newSymbols);
            } else {
                console.log('未发现新代币');
            }
        } catch (error) {
            console.error('检查新代币时出错:', error);
        }
    }
    
    async notifyNewTokens(newSymbols) {
        // 获取新代币的详细信息
        const tokenDetails = [];
        for (const symbol of newSymbols) {
            try {
                const response = await axios.get(`${process.env.BINANCE_REST_API}/ticker/24hr`, {
                    params: { symbol }
                });
                
                const data = response.data;
                tokenDetails.push({
                    symbol: symbol,
                    price: parseFloat(data.lastPrice),
                    volume: parseFloat(data.volume),
                    priceChange: parseFloat(data.priceChangePercent)
                });
            } catch (error) {
                console.error(`获取 ${symbol} 详细信息时出错:`, error);
                tokenDetails.push({
                    symbol: symbol,
                    price: 0,
                    volume: 0,
                    priceChange: 0
                });
            }
        }
        
        // 构建消息
        let message = `🆕 *新代币上线提醒* 🆕\n\n`;
        message += `*发现 ${newSymbols.length} 个新上线的代币：*\n\n`;
        
        for (const token of tokenDetails) {
            const priceChange = token.priceChange;
            const emoji = priceChange >= 0 ? '📈' : '📉';
            const trend = priceChange >= 0 ? '上涨' : '下跌';
            
            message += `${index + 1}. *${token.symbol}*\n`;
            message += `   • 当前价格: ${token.price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})} USDT\n`;
            message += `   • 24小时变化: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}% (${trend}) ${emoji}\n`;
            message += `   • 24小时成交量: ${token.volume.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${token.symbol.replace('USDT', '')}\n\n`;
        }
        
        message += `_时间: ${new Date().toLocaleString()}_`;
        
        // 只发送到电报频道
        bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { parse_mode: 'Markdown' });
    }

    async subscribeToAllSymbols() {
        try {
            // 获取所有交易对信息
            const response = await axios.get(`${process.env.BINANCE_REST_API}/exchangeInfo`);
            const allSymbols = response.data.symbols
                .filter(symbol => symbol.quoteAsset === 'USDT' && symbol.status === 'TRADING')
                .map(symbol => symbol.symbol);
            
            console.log(`发现 ${allSymbols.length} 个USDT交易对`);
            
            // 初始化已知交易对集合
            allSymbols.forEach(symbol => {
                this.knownSymbols.add(symbol);
            });
            
            // 获取24小时交易量数据，找出交易量前50的交易对
            const volumeResponse = await axios.get(`${process.env.BINANCE_REST_API}/ticker/24hr`);
            const topSymbols = volumeResponse.data
                .filter(item => item.symbol.endsWith('USDT'))
                .sort((a, b) => parseFloat(b.volume) - parseFloat(a.volume))
                .slice(0, TOP_SYMBOLS_COUNT)
                .map(item => item.symbol);
            
            this.topSymbols = new Set(topSymbols);
            console.log(`已选择交易量前 ${topSymbols.length} 个USDT交易对`);
            
            // 获取交易量前10的交易对
            const focusSymbols = topSymbols.slice(0, FOCUS_SYMBOLS_COUNT);
            this.focusSymbols = new Set(focusSymbols);
            console.log(`已选择重点监控的 ${focusSymbols.length} 个USDT交易对`);
            
            // 订阅所有交易对
            const subscribeMsg = {
                method: 'SUBSCRIBE',
                params: allSymbols.map(symbol => `${symbol.toLowerCase()}@ticker`),
                id: Date.now()
            };
            
            this.ws.send(JSON.stringify(subscribeMsg));
            console.log('已订阅所有USDT交易对');
            
            // 初始化价格数据
            allSymbols.forEach(symbol => {
                if (!allSymbolsData.has(symbol)) {
                    allSymbolsData.set(symbol, {
                        lastPrice: 0,
                        priceChange: 0,
                        lastAlertTime: 0,
                        lastShortTermAlertTime: 0
                    });
                }
                
                // 初始化价格历史
                if (!this.priceHistory.has(symbol)) {
                    this.priceHistory.set(symbol, []);
                }
            });
        } catch (error) {
            console.error('订阅所有交易对时出错:', error);
        }
    }

    handleMessage(message) {
        if (message.e === '24hrTicker') {
            this.handleTickerUpdate(message);
        }
    }

    async handleTickerUpdate(data) {
        const symbol = data.s;
        const price = parseFloat(data.c);
        const now = Date.now();
        
        if (!this.topSymbols.has(symbol)) return;

        // 更新价格历史
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
        }
        const history = this.priceHistory.get(symbol);
        history.push({ price, timestamp: now });
        
        // 清理30分钟以前的数据
        history.filter(record => now - record.timestamp <= 30 * 60 * 1000);
        
        // 计算30分钟价格变化
        let priceChange = 0;
        if (history.length > 1) {
            const oldestPrice = history[0].price;
            priceChange = ((price - oldestPrice) / oldestPrice) * 100;
            
            // 只在价格突变时发送提醒
            if (Math.abs(priceChange) >= SHORT_TERM_PRICE_CHANGE_THRESHOLD) {
                const symbolData = allSymbolsData.get(symbol);
                if (now - symbolData.lastShortTermAlertTime > 15 * 60 * 1000) { // 15分钟内不重复提醒
                    symbolData.lastShortTermAlertTime = now;
                    
                    // 获取AI分析
                    const aiAnalysis = await this.getAIAnalysis(symbol, price, priceChange, history);
                    
                    // 发送突变提醒
                    this.notifyShortTermPriceAlert(symbol, price, priceChange, aiAnalysis);
                }
            }
        }
        
        // 更新价格数据
        if (allSymbolsData.has(symbol)) {
            const symbolData = allSymbolsData.get(symbol);
            symbolData.lastPrice = price;
            symbolData.priceChange = priceChange;
        }
    }
    
    async getAIAnalysis(symbol, price, priceChange, priceHistory) {
        try {
            // 计算技术指标
            const prices = priceHistory.map(item => item.price);
            const times = priceHistory.map(item => new Date(item.timestamp).toLocaleTimeString());
            
            // 计算移动平均线
            const ma5 = calculateMA(prices, 5);
            const ma10 = calculateMA(prices, 10);
            const ma20 = calculateMA(prices, 20);
            
            // 计算RSI
            const rsi = calculateRSI(prices, 14);
            
            // 计算布林带
            const { upper, middle, lower } = calculateBollingerBands(prices, 20, 2);
            
            // 计算成交量分析
            const volumeAnalysis = await getVolumeAnalysis(symbol);
            
            // 获取市场情绪数据
            const marketSentiment = await getMarketSentiment(symbol);
            
            // 计算支撑位和阻力位
            const { supports, resistances } = calculateSupportResistance(prices);

            // 构建增强的AI分析提示
            let prompt = `作为一位专业的加密货币分析师，请对${symbol}进行全面深入的技术分析。

基础数据:
- 当前价格: ${price} USDT
- 30分钟价格变化: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%
- 价格历史: ${JSON.stringify(prices)}

技术指标:
- MA5: ${ma5[ma5.length - 1]}
- MA10: ${ma10[ma10.length - 1]}
- MA20: ${ma20[ma20.length - 1]}
- RSI(14): ${rsi.toFixed(2)}
- 布林带:
  * 上轨: ${upper[upper.length - 1]}
  * 中轨: ${middle[middle.length - 1]}
  * 下轨: ${lower[lower.length - 1]}

市场数据:
- 24小时成交量: ${volumeAnalysis.volume24h} USDT
- 买卖比例: ${volumeAnalysis.buyVsSell}
- 大单交易占比: ${volumeAnalysis.largeTransactions}%
- 市场情绪指数: ${marketSentiment.score}
- 社交媒体讨论热度: ${marketSentiment.socialVolume}

价格关键位:
- 支撑位: ${supports.join(', ')} USDT
- 阻力位: ${resistances.join(', ')} USDT

请提供以下分析:

1. 技术面分析:
   - 移动平均线趋势判断
   - RSI超买超卖分析
   - 布林带位置判断
   - 支撑位和阻力位分析
   - 可能的价格突破点位

2. 市场情绪分析:
   - 当前市场情绪评估
   - 大资金流向判断
   - 社交媒体情绪影响
   - 潜在的市场催化剂

3. 交易量分析:
   - 成交量变化趋势
   - 大单交易影响
   - 买卖压力分析

4. 风险评估:
   - 短期风险因素
   - 止损位建议
   - 波动风险预警
   - 潜在风险事件

5. 操作建议:
   - 短期价格目标
   - 建议入场位
   - 止损止盈位
   - 仓位管理建议

请用专业简洁的语言回答，重点突出异常信号和重要风险。`;

            // 调用 DeepSeek API
            const response = await axios.post(
                DEEPSEEK_API_URL,
                {
                    model: "deepseek-chat",
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.7,
                    max_tokens: 1500  // 增加token限制以获取更详细的分析
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                    }
                }
            );

            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('调用DeepSeek API时出错:', error);
            return '无法获取AI分析，请稍后再试。';
        }
    }

    // 计算移动平均线
    calculateMA(prices, period) {
        const result = [];
        for (let i = 0; i < prices.length; i++) {
            if (i < period - 1) {
                result.push(null);
                continue;
            }
            const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            result.push(sum / period);
        }
        return result;
    }

    // 计算RSI
    calculateRSI(prices, period) {
        let gains = 0;
        let losses = 0;
        
        // 计算初始的gains和losses
        for(let i = 1; i < period; i++) {
            const difference = prices[i] - prices[i-1];
            if(difference >= 0) {
                gains += difference;
            } else {
                losses -= difference;
            }
        }
        
        // 计算初始的平均gains和losses
        let avgGain = gains / period;
        let avgLoss = losses / period;
        
        // 使用递推公式计算RSI
        for(let i = period; i < prices.length; i++) {
            const difference = prices[i] - prices[i-1];
            if(difference >= 0) {
                avgGain = (avgGain * (period - 1) + difference) / period;
                avgLoss = (avgLoss * (period - 1)) / period;
            } else {
                avgGain = (avgGain * (period - 1)) / period;
                avgLoss = (avgLoss * (period - 1) - difference) / period;
            }
        }
        
        const RS = avgGain / avgLoss;
        return 100 - (100 / (1 + RS));
    }

    // 计算布林带
    calculateBollingerBands(prices, period, multiplier) {
        const middle = calculateMA(prices, period);
        const upper = [];
        const lower = [];
        
        for (let i = 0; i < prices.length; i++) {
            if (i < period - 1) {
                upper.push(null);
                lower.push(null);
                continue;
            }
            
            const slice = prices.slice(i - period + 1, i + 1);
            const std = calculateStandardDeviation(slice);
            upper.push(middle[i] + (multiplier * std));
            lower.push(middle[i] - (multiplier * std));
        }
        
        return { upper, middle, lower };
    }

    // 计算标准差
    calculateStandardDeviation(values) {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const squareDiffs = values.map(value => Math.pow(value - mean, 2));
        const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
        return Math.sqrt(avgSquareDiff);
    }

    // 计算支撑位和阻力位
    calculateSupportResistance(prices) {
        const supports = [];
        const resistances = [];
        const window = 5; // 寻找局部最大最小值的窗口大小
        
        for (let i = window; i < prices.length - window; i++) {
            const current = prices[i];
            const leftPrices = prices.slice(i - window, i);
            const rightPrices = prices.slice(i + 1, i + window + 1);
            
            // 检查是否是局部最小值(支撑位)
            if (leftPrices.every(p => p > current) && rightPrices.every(p => p > current)) {
                supports.push(current);
            }
            
            // 检查是否是局部最大值(阻力位)
            if (leftPrices.every(p => p < current) && rightPrices.every(p => p < current)) {
                resistances.push(current);
            }
        }
        
        // 只返回最近的3个支撑位和阻力位
        return {
            supports: supports.slice(-3),
            resistances: resistances.slice(-3)
        };
    }

    // 获取成交量分析
    async getVolumeAnalysis(symbol) {
        try {
            const response = await axios.get(`${process.env.BINANCE_REST_API}/ticker/24hr`, {
                params: { symbol }
            });
            
            return {
                volume24h: parseFloat(response.data.volume),
                buyVsSell: response.data.priceChangePercent > 0 ? 
                    'Buy Pressure Dominant' : 'Sell Pressure Dominant',
                largeTransactions: Math.random() * 100  // 这里需要替换为实际的大单数据
            };
        } catch (error) {
            console.error('获取成交量数据失败:', error);
            return {
                volume24h: 0,
                buyVsSell: 'Unknown',
                largeTransactions: 0
            };
        }
    }

    // 获取市场情绪
    async getMarketSentiment(symbol) {
        // 这里可以接入专业的市场情绪API
        // 目前使用模拟数据
        return {
            score: Math.random() * 100,
            socialVolume: Math.floor(Math.random() * 1000)
        };
    }

    async notifyShortTermPriceAlert(symbol, price, priceChange, aiAnalysis) {
        const emoji = priceChange > 0 ? '📈' : '📉';
        const trend = priceChange > 0 ? '上涨' : '下跌';
        
        const message = `${emoji} *${symbol} 价格${trend}提醒* ${emoji}\n\n` +
            `*交易对:* ${symbol}\n` +
            `*当前价格:* ${price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})} USDT\n` +
            `*短期变化:* ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%\n` +
            `\n*AI分析:*\n${aiAnalysis}\n\n` +
            `_时间: ${new Date().toLocaleString()}_`;
        
        // 只发送到电报频道
        bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { parse_mode: 'Markdown' });
    }

    startBTCDailyAnalysis() {
        // 清除可能存在的旧定时器
        this.stopBTCDailyAnalysis();
        
        // 设置新的定时器，每天分析BTC
        this.btcDailyAnalysisTimer = setInterval(() => {
            this.performBTCDailyAnalysis();
        }, BTC_DAILY_ANALYSIS_INTERVAL);
        
        console.log(`已启动BTC每日分析 (间隔: ${BTC_DAILY_ANALYSIS_INTERVAL / (60 * 60 * 1000)} 小时)`);
        
        // 立即执行一次分析
        this.performBTCDailyAnalysis();
    }
    
    stopBTCDailyAnalysis() {
        if (this.btcDailyAnalysisTimer) {
            clearInterval(this.btcDailyAnalysisTimer);
            this.btcDailyAnalysisTimer = null;
            console.log('已停止BTC每日分析');
        }
    }
    
    async performBTCDailyAnalysis() {
        try {
            console.log('正在执行BTC每日分析...');
            
            // 获取BTC的24小时数据
            const response = await axios.get(`${process.env.BINANCE_REST_API}/ticker/24hr`, {
                params: { symbol: 'BTCUSDT' }
            });
            
            const data = response.data;
            const currentPrice = parseFloat(data.lastPrice);
            const priceChange = parseFloat(data.priceChangePercent);
            const highPrice = parseFloat(data.highPrice);
            const lowPrice = parseFloat(data.lowPrice);
            const volume = parseFloat(data.volume);
            
            // 获取BTC的K线数据（过去7天）
            const klineResponse = await axios.get(`${process.env.BINANCE_REST_API}/klines`, {
                params: {
                    symbol: 'BTCUSDT',
                    interval: '1d',
                    limit: 7
                }
            });
            
            const klineData = klineResponse.data.map(item => ({
                time: new Date(item[0]).toLocaleDateString(),
                open: parseFloat(item[1]),
                high: parseFloat(item[2]),
                low: parseFloat(item[3]),
                close: parseFloat(item[4]),
                volume: parseFloat(item[5])
            }));
            
            // 获取AI分析
            const aiAnalysis = await this.getBTCAIAnalysis(currentPrice, priceChange, klineData);
            
            // 保存分析历史
            const analysisRecord = {
                date: new Date().toISOString(),
                price: currentPrice,
                priceChange: priceChange,
                analysis: aiAnalysis
            };
            
            this.btcAnalysisHistory.push(analysisRecord);
            
            // 只保留最近30天的分析历史
            if (this.btcAnalysisHistory.length > 30) {
                this.btcAnalysisHistory.shift();
            }
            
            // 发送分析通知
            this.notifyBTCDailyAnalysis(currentPrice, priceChange, highPrice, lowPrice, volume, aiAnalysis);
            
            console.log('已完成BTC每日分析');
        } catch (error) {
            console.error('执行BTC每日分析时出错:', error);
        }
    }
    
    async getBTCAIAnalysis(currentPrice, priceChange, klineData) {
        try {
            // 构建更详细的提示
            let prompt = `作为一位专业的加密货币分析师，请对比特币(BTC)进行每日分析：\n\n` +
                `当前价格: ${currentPrice} USDT\n` +
                `24小时变化: ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%\n\n` +
                `过去7天K线数据:\n${JSON.stringify(klineData)}\n\n`;
            
            // 如果有历史分析，添加到提示中
            if (this.btcAnalysisHistory.length > 0) {
                const lastAnalysis = this.btcAnalysisHistory[this.btcAnalysisHistory.length - 1];
                prompt += `上次分析日期: ${new Date(lastAnalysis.date).toLocaleDateString()}\n` +
                    `上次分析价格: ${lastAnalysis.price} USDT\n` +
                    `上次分析变化: ${lastAnalysis.priceChange > 0 ? '+' : ''}${lastAnalysis.priceChange.toFixed(2)}%\n` +
                    `上次分析内容:\n${lastAnalysis.analysis}\n\n`;
            }
            
            prompt += `请提供以下分析：\n` +
                `1. 市场分析：\n` +
                `   - 价格变动的主要原因\n` +
                `   - 市场情绪分析\n` +
                `   - 技术面分析\n\n` +
                `2. 投资建议：\n` +
                `   - 短期操作建议\n` +
                `   - 风险提示\n` +
                `   - 关键价位关注点\n\n` +
                `3. 市场展望：\n` +
                `   - 可能的发展趋势\n` +
                `   - 需要关注的重要事件\n` +
                `   - 潜在机会和风险\n\n` +
                `4. 学习与改进：\n` +
                `   - 与上次分析的对比\n` +
                `   - 预测准确性评估\n` +
                `   - 需要改进的分析点\n\n` +
                `请用简洁专业的语言回答，突出重点。`;
            
            // 调用 DeepSeek API
            const response = await axios.post(
                DEEPSEEK_API_URL,
                {
                    model: "deepseek-chat",
                    messages: [
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.7,
                    max_tokens: 1200
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
                    }
                }
            );
            
            return response.data.choices[0].message.content;
        } catch (error) {
            console.error('调用DeepSeek API时出错:', error);
            return '无法获取BTC AI分析，请稍后再试。';
        }
    }
    
    async notifyBTCDailyAnalysis(currentPrice, priceChange, highPrice, lowPrice, volume, aiAnalysis) {
        const emoji = priceChange > 0 ? '📈' : '📉';
        const trend = priceChange > 0 ? '上涨' : '下跌';
        
        const message = `${emoji} *比特币(BTC)每日分析* ${emoji}\n\n` +
            `*当前价格:* ${currentPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDT\n` +
            `*24小时变化:* ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}%\n` +
            `*24小时最高:* ${highPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDT\n` +
            `*24小时最低:* ${lowPrice.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USDT\n` +
            `*24小时成交量:* ${volume.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} BTC\n\n` +
            `*AI分析:*\n${aiAnalysis}\n\n` +
            `_时间: ${new Date().toLocaleString()}_`;
        
        // 只发送到电报频道
        bot.sendMessage(TELEGRAM_CHANNEL_ID, message, { parse_mode: 'Markdown' });
    }
}

// 初始化 WebSocket 连接
const binanceWS = new BinanceWebSocket();
binanceWS.connect();

// 处理机器人命令
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const message = `🚀 *欢迎使用币安监控机器人！*\n\n` +
        `*可用命令：*\n` +
        `📊 \`/subscribe\` - 订阅所有代币价格提醒\n` +
        `❌ \`/unsubscribe\` - 取消订阅\n` +
        `💰 \`/price <币种>\` - 查询当前价格\n` +
        `📈 \`/top\` - 查看涨幅最大的代币\n` +
        `📉 \`/bottom\` - 查看跌幅最大的代币\n` +
        `❓ \`/help\` - 显示帮助信息\n\n` +
        `*提示：*\n` +
        `• 只监控交易量前 ${TOP_SYMBOLS_COUNT} 的代币\n` +
        `• 交易量前 ${FOCUS_SYMBOLS_COUNT} 的代币为重点监控对象\n` +
        `• 价格变动超过 ${PRICE_CHANGE_THRESHOLD}% 时会收到提醒\n` +
        `• 短期价格变动超过 ${SHORT_TERM_PRICE_CHANGE_THRESHOLD}% 时会收到突然上涨/下跌提醒（含AI分析）\n` +
        `• 10分钟后会收到AI跟进分析，评估之前的投资建议\n` +
        `• 每天会对BTC进行AI分析并学习改进\n` +
        `• 新代币上线时会收到提醒\n` +
        `• 每天更新交易量排名\n` +
        `• 监控所有币安 USDT 交易对\n` +
        `• 所有提醒也会发送到电报频道`;
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

bot.onText(/\/subscribe/, (msg) => {
    const chatId = msg.chat.id;
    
    if (!userSubscriptions.has('all')) {
        userSubscriptions.set('all', new Set());
    }
    userSubscriptions.get('all').add(chatId);
    
    bot.sendMessage(chatId, `✅ 已订阅所有代币的价格提醒\n\n` +
        `*提示：*\n` +
        `• 只监控交易量前 ${TOP_SYMBOLS_COUNT} 的代币\n` +
        `• 交易量前 ${FOCUS_SYMBOLS_COUNT} 的代币为重点监控对象\n` +
        `• 价格变动超过 ${PRICE_CHANGE_THRESHOLD}% 时会收到提醒\n` +
        `• 短期价格变动超过 ${SHORT_TERM_PRICE_CHANGE_THRESHOLD}% 时会收到突然上涨/下跌提醒（含AI分析）\n` +
        `• 10分钟后会收到AI跟进分析，评估之前的投资建议\n` +
        `• 每天会对BTC进行AI分析并学习改进\n` +
        `• 新代币上线时会收到提醒\n` +
        `• 每天更新交易量排名\n` +
        `• 使用 \`/unsubscribe\` 取消订阅\n` +
        `• 所有提醒也会发送到电报频道`, 
        { parse_mode: 'Markdown' });
});

bot.onText(/\/unsubscribe/, (msg) => {
    const chatId = msg.chat.id;
    
    if (userSubscriptions.has('all')) {
        userSubscriptions.get('all').delete(chatId);
        if (userSubscriptions.get('all').size === 0) {
            userSubscriptions.delete('all');
        }
        bot.sendMessage(chatId, `✅ 已取消订阅所有代币的价格提醒`);
    } else {
        bot.sendMessage(chatId, `❌ 您未订阅任何代币的价格提醒`);
    }
});

bot.onText(/\/price (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const symbol = match[1].toUpperCase() + 'USDT';  // 自动添加 USDT 后缀
    
    try {
        const response = await axios.get(`${process.env.BINANCE_REST_API}/ticker/24hr`, {
            params: { symbol }
        });
        
        const data = response.data;
        const priceChange = parseFloat(data.priceChangePercent);
        const emoji = priceChange >= 0 ? '📈' : '📉';
        const trend = priceChange >= 0 ? '上涨' : '下跌';
        
        const message = `${emoji} *${symbol} 价格信息* ${emoji}\n\n` +
            `*当前价格:* ${parseFloat(data.lastPrice).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})} USDT\n` +
            `*24小时最高:* ${parseFloat(data.highPrice).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})} USDT\n` +
            `*24小时最低:* ${parseFloat(data.lowPrice).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})} USDT\n` +
            `*24小时成交量:* ${parseFloat(data.volume).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${symbol.replace('USDT', '')}\n` +
            `*24小时变化:* ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}% (${trend})\n\n` +
            `_更新时间: ${new Date().toLocaleString()}_`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        bot.sendMessage(chatId, `❌ 获取 ${symbol} 价格信息失败`);
    }
});

bot.onText(/\/top/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const response = await axios.get(`${process.env.BINANCE_REST_API}/ticker/24hr`);
        const data = response.data
            .filter(item => item.symbol.endsWith('USDT'))
            .sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent))
            .slice(0, 10);
        
        let message = `📈 *涨幅最大的10个代币* 📈\n\n`;
        
        data.forEach((item, index) => {
            const priceChange = parseFloat(item.priceChangePercent);
            const price = parseFloat(item.lastPrice);
            message += `${index + 1}. *${item.symbol}*: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}% | ${price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})} USDT\n`;
        });
        
        message += `\n_更新时间: ${new Date().toLocaleString()}_`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        bot.sendMessage(chatId, `❌ 获取涨幅数据失败`);
    }
});

bot.onText(/\/bottom/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const response = await axios.get(`${process.env.BINANCE_REST_API}/ticker/24hr`);
        const data = response.data
            .filter(item => item.symbol.endsWith('USDT'))
            .sort((a, b) => parseFloat(a.priceChangePercent) - parseFloat(b.priceChangePercent))
            .slice(0, 10);
        
        let message = `📉 *跌幅最大的10个代币* 📉\n\n`;
        
        data.forEach((item, index) => {
            const priceChange = parseFloat(item.priceChangePercent);
            const price = parseFloat(item.lastPrice);
            message += `${index + 1}. *${item.symbol}*: ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}% | ${price.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 8})} USDT\n`;
        });
        
        message += `\n_更新时间: ${new Date().toLocaleString()}_`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        bot.sendMessage(chatId, `❌ 获取跌幅数据失败`);
    }
});

bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const message = `📚 *帮助信息*\n\n` +
        `*命令列表：*\n` +
        `🚀 \`/start\` - 开始使用机器人\n` +
        `📊 \`/subscribe\` - 订阅所有代币价格提醒\n` +
        `❌ \`/unsubscribe\` - 取消订阅\n` +
        `💰 \`/price <币种>\` - 查询当前价格\n` +
        `📈 \`/top\` - 查看涨幅最大的代币\n` +
        `📉 \`/bottom\` - 查看跌幅最大的代币\n` +
        `❓ \`/help\` - 显示此帮助信息\n\n` +
        `*提示：*\n` +
        `• 只监控交易量前 ${TOP_SYMBOLS_COUNT} 的代币\n` +
        `• 交易量前 ${FOCUS_SYMBOLS_COUNT} 的代币为重点监控对象\n` +
        `• 价格变动超过 ${PRICE_CHANGE_THRESHOLD}% 时会收到提醒\n` +
        `• 短期价格变动超过 ${SHORT_TERM_PRICE_CHANGE_THRESHOLD}% 时会收到突然上涨/下跌提醒（含AI分析）\n` +
        `• 10分钟后会收到AI跟进分析，评估之前的投资建议\n` +
        `• 每天会对BTC进行AI分析并学习改进\n` +
        `• 新代币上线时会收到提醒\n` +
        `• 每天更新交易量排名\n` +
        `• 监控所有币安 USDT 交易对\n` +
        `• 数据实时更新\n` +
        `• 所有提醒也会发送到电报频道`;
    bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// 错误处理
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

const MESSAGE_DELAY = 1000; // 消息发送延迟1秒
const messageQueue = [];
let isProcessingQueue = false;

// 添加延迟函数
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 添加消息队列处理函数
async function processMessageQueue() {
  if (isProcessingQueue || messageQueue.length === 0) return;
  
  isProcessingQueue = true;
  while (messageQueue.length > 0) {
    const { chatId, message } = messageQueue.shift();
    try {
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      await delay(MESSAGE_DELAY);
    } catch (error) {
      console.error('发送消息失败:', error);
      if (error.code === 'ETELEGRAM' && error.response.body.error_code === 429) {
        // 如果遇到速率限制，等待指定时间后重试
        const retryAfter = error.response.body.parameters.retry_after || 5;
        await delay(retryAfter * 1000);
        messageQueue.unshift({ chatId, message });
      }
    }
  }
  isProcessingQueue = false;
}

// 修改发送消息的函数
async function sendMessage(chatId, message) {
  messageQueue.push({ chatId, message });
  processMessageQueue();
}

// 修改所有使用bot.sendMessage的地方
async function notifyPriceAlert(symbol, price, priceChange) {
  const message = `🔔 *${symbol} 价格${priceChange > 0 ? '上涨' : '下跌'}提醒* 🔔\n\n` +
    `*交易对:* ${symbol}\n` +
    `*当前价格:* ${price} USDT\n` +
    `*24小时变化:* ${priceChange > 0 ? '+' : ''}${priceChange}%\n\n` +
    `_时间: ${new Date().toLocaleString()}_`;
  
  // 发送给订阅用户
  for (const userId of subscribedUsers) {
    await sendMessage(userId, message);
  }
  
  // 发送到频道
  await sendMessage(TELEGRAM_CHANNEL_ID, message);
}

async function notifyShortTermPriceAlert(symbol, price, priceChange, aiAnalysis) {
  const message = `🚨 *${symbol} 价格${priceChange > 0 ? '暴涨' : '暴跌'}提醒* 🚨\n\n` +
    `*交易对:* ${symbol}\n` +
    `*当前价格:* ${price} USDT\n` +
    `*30分钟变化:* ${priceChange > 0 ? '+' : ''}${priceChange}%\n\n` +
    `*AI分析:*\n${aiAnalysis}\n\n` +
    `_时间: ${new Date().toLocaleString()}_`;
  
  // 发送给订阅用户
  for (const userId of subscribedUsers) {
    await sendMessage(userId, message);
  }
  
  // 发送到频道
  await sendMessage(TELEGRAM_CHANNEL_ID, message);
}

async function notifyNewTokens(newSymbols) {
  const message = `🆕 *新币上线提醒* 🆕\n\n` +
    newSymbols.map(token => 
      `*${token.symbol}*\n` +
      `价格: ${token.price} USDT\n` +
      `24h成交量: ${token.volume} USDT\n` +
      `24h涨跌幅: ${token.priceChange}%\n`
    ).join('\n') +
    `\n_时间: ${new Date().toLocaleString()}_`;
  
  // 发送给订阅用户
  for (const userId of subscribedUsers) {
    await sendMessage(userId, message);
  }
  
  // 发送到频道
  await sendMessage(TELEGRAM_CHANNEL_ID, message);
}

async function notifyVolumeUpdate(topSymbols) {
  const message = `📊 *交易量排名更新* 📊\n\n` +
    `*前10名交易对:*\n` +
    topSymbols.slice(0, 10).map((symbol, index) => 
      `${index + 1}. ${symbol.symbol}: ${symbol.volume} USDT`
    ).join('\n') +
    `\n\n_时间: ${new Date().toLocaleString()}_`;
  
  // 发送给订阅用户
  for (const userId of subscribedUsers) {
    await sendMessage(userId, message);
  }
  
  // 发送到频道
  await sendMessage(TELEGRAM_CHANNEL_ID, message);
} 