let logs = [];

function debugLog(category, ...args) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] [${category}] ${args.join(' ')}`;
    console.log(logEntry);
    logs.push(logEntry);
    if (logs.length > 100) logs.shift();
}

function getRecentLogs() {
    return logs.join('\n');
}

module.exports = { debugLog, getRecentLogs };
