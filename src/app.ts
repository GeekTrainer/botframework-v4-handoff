import { Bot, TestAdapter } from 'botbuilder';
import { BotFrameworkAdapter } from 'botbuilder-services';
import * as restify from 'restify';

// Create server
let server = restify.createServer();
server.listen(process.env.port || process.env.PORT || 3978, function () {
    console.log(`${server.name} listening to ${server.url}`);
});

// Create adapter and listen to servers '/api/messages' route.
const adapter = new BotFrameworkAdapter({ 
    appId: process.env.MICROSOFT_APP_ID, 
    appPassword: process.env.MICROSOFT_APP_PASSWORD 
});
server.post('/api/messages', (adapter as any).listen());

// Initialize bot by passing it adapter
const bot = new Bot(adapter);

// Define the bots onReceive message handler
bot.onReceive((context) => {
    if (context.request.type === 'message') {
        context.reply(`Hello World`);
    }
});