import { ConversationReference, Activity, Bot, TestAdapter, TemplateManager, ConversationResourceResponse } from "botbuilder";


export class TestContext implements BotContext {
    constructor(conversationReference: ConversationReference, request: Activity | string) {
        if(typeof request !== "object") {
            request = { type: "message", text: request };
        }
        this.conversationReference = conversationReference;
        this.request = request;
        this.bot = new Bot(new TestAdapter);
        this.bot.createContext =
            (reference: ConversationReference, onReady: (context: BotContext) => void) => {
                onReady(this);
                return Promise.resolve();
            };

        this.responses = [];
    }
    public request: Activity;
    public responses: Activity[];
    public bot: Bot;
    public responded: boolean = false;
    public conversationReference: ConversationReference;
    public state: BotState;
    public templateManager: TemplateManager;

    public delay(duration: number) { return this; }
    public dispose() {}
    public endOfConversation(code?: string) { return this; }
    public replyWith(id: string, data: any) { return this; }
    public flushResponses() { 
        return new Promise<ConversationResourceResponse[]>(
            (value) => {}
        );
    }
    public showTyping() {
        return this;
    }

    public reply(textOrActivity : string | Activity) {
        if(typeof textOrActivity !== "object") {
            textOrActivity = { type: "message", text: textOrActivity };
        }
        this.responses.unshift(textOrActivity);
        return this;
    }
}

export const getConversationReference = (id: string, name: string) => {
    return { user: { id, name } } as ConversationReference;
}

export const userReference = getConversationReference("user", "user");

export const agentReference = getConversationReference("agent", "agent");
