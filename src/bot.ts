import { TestAdapter, Bot, ActivityAdapter, MiddlewareSet } from "botbuilder";
import { BotFrameworkAdapter } from "botbuilder-services";
import { HandoffMiddleware } from './handoff-middleware';

export const createBot = (
    adapter: ActivityAdapter = new BotFrameworkAdapter(),
    middleware: MiddlewareSet = new MiddlewareSet()
) => {
    const bot = new Bot(adapter).use(middleware);

    bot.onReceive((context) => {
        if (context.request.type === 'message') {
            context.reply(`Hello`);
        }
    });

    return bot;
}