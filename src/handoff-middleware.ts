import { ConversationReference, ChannelAccount, ConversationAccount, Activity } from 'botbuilder'

export enum HandoffUserState {
    bot,
    queued,
    agent
}

export interface Message {
    from: string;
    text: string;
}

export interface HandoffUser {
    userReference: ConversationReference;
    messages: Message[];
    state: HandoffUserState;
    agentReference?: ConversationReference;
    queueTime?: Date;
}

export class HandoffMiddleware {
    private _provider: HandoffProvider;
    get provider(): HandoffProvider {
        return this._provider;
    }

    public constructor(provider: HandoffProvider) {
        this._provider = provider;
    }

    public async receiveActivity(context: Partial<BotContext>, next: () => Promise<void>) {
        if (!context.request || context.request.type !== "message" || !context.request.text) {
            return next();
        }

        if (context.conversationReference &&
            context.conversationReference.user &&
            context.conversationReference.user.name.toLocaleLowerCase().startsWith("agent")
        ) {
            return this.manageAgent(context, next)
        } else {
            return this.manageUser(context, next);
        }
    }

    private async manageUser(context: Partial<BotContext>, next: () => Promise<void>) {
        const user = await this.provider.findOrCreate(context.conversationReference);
        this.provider.log(user, user.userReference.user.name, context.request.text);

        if(user.state === HandoffUserState.agent) {
            return context.bot.createContext(user.agentReference, (agentContext) => {
                agentContext.reply(context.request.text);
            });
        }

        switch (context.request.text.toLowerCase()) {
            // check for command
            case "agent":
                await this.provider.queueForAgent(context.conversationReference);
                context.reply("Waiting for agent");
                return Promise.resolve();
            case "cancel":
                await this.provider.unqueueForAgent(context.conversationReference);
                context.reply("Connected to bot");
                return Promise.resolve();
        }

        return next();
    }

    private async manageAgent(context: Partial<BotContext>, next: () => Promise<void>) {
        const text = context.request.text.toLowerCase();

        // check if connected to user
        const connectedUser = await this.provider.findByAgent(context.conversationReference);
        if(!connectedUser && text.indexOf("#") !== 0) return next();

        if (connectedUser) {
            // route message
            if (text === "#disconnect") {
                await this.provider.disconnectFromAgent(context.conversationReference);
                context.reply("Reconnected to bot");
                return Promise.resolve();
            } else if (text.indexOf("#") === 0) {
                context.reply("Command not valid when connected to user.");
                return Promise.resolve();
            } else {
                this.provider.log(connectedUser, context.conversationReference.user.name, context.request.text);
                return context.bot.createContext(connectedUser.userReference, (userContext) => {
                    userContext.reply(context.request.text);
                });
            }
        }

        // check for command
        switch (text.substring(1)) {
            case "list":
                const currentQueue = await this.provider.getQueue();
                let message = "";
                currentQueue.forEach(u => message += "- " + u.userReference.user.name + "\n\n");
                context.reply(message);
                return;
            case "connect":
                // TODO: Reject if already connected
                const handoffUser = await this.provider.connectToAgent(context.conversationReference);
                if (handoffUser) {
                    context.reply("Connected to " + handoffUser.userReference.user.name);
                } else {
                    context.reply("Nobody in the queue.");
                }
                return;
        }
    }
}

export interface HandoffProvider {
    // HandoffUserManagement
    findOrCreate(userReference: ConversationReference): Promise<HandoffUser>;
    save(user: HandoffUser): Promise<void>;
    log(user: HandoffUser, from: string, text: string): Promise<HandoffUser>;

    // Connection management
    findByAgent(agentReference: ConversationReference): Promise<HandoffUser>;

    // Queue management
    queueForAgent(userReference: ConversationReference): Promise<HandoffUser>;
    unqueueForAgent(userReference: ConversationReference): Promise<HandoffUser>;
    connectToAgent(agentReference: ConversationReference): Promise<HandoffUser>;
    disconnectFromAgent(agentReference: ConversationReference): Promise<HandoffUser>;
    getQueue(): Promise<HandoffUser[]>;
}

export class ArrayHandoffProvider implements HandoffProvider {
    backingStore: HandoffUser[];

    constructor(backingStore: HandoffUser[] = []) {
        this.backingStore = backingStore;
    }

    // HandoffUser management
    async findOrCreate(userReference: ConversationReference) {
        const results = this.backingStore.filter(u => u.userReference.user.id === userReference.user.id);
        if (results.length > 0) {
            return Promise.resolve(results[0]);
        } else {
            const user: HandoffUser = {
                userReference: userReference,
                state: HandoffUserState.bot,
                messages: []
            };
            this.backingStore.unshift(user);
            await this.save(user);
            return Promise.resolve(user);
        }
    }

    save(user: HandoffUser) {
        // Array doesn't need to be updated if object changes
        return Promise.resolve();
    }

    async log(user: HandoffUser, from: string, text: string) {
        user.messages.unshift({ from, text });
        await this.save(user);
        return Promise.resolve(user);
    }

    findByAgent(agentReference: ConversationReference) {
        const result = this.backingStore.filter(u => u.agentReference && u.agentReference.user.id === agentReference.user.id);
        if (result.length > 0) return Promise.resolve(result[0]);
        else return Promise.resolve(null);
    }

    // Queue management
    async queueForAgent(userReference: ConversationReference) {
        const user = await this.findOrCreate(userReference);
        user.state = HandoffUserState.queued;
        user.queueTime = new Date();
        await this.save(user);
        return Promise.resolve(user);
    }

    async unqueueForAgent(userReference: ConversationReference) {
        const user = await this.findOrCreate(userReference);
        user.state = HandoffUserState.bot;
        user.queueTime = null;
        await this.save(user);
        return Promise.resolve(user);
    }

    async connectToAgent(agentReference: ConversationReference) {
        const results = this.backingStore.sort(u => u.queueTime.getTime());
        if (results.length > 0) {
            const user = results[0];
            user.queueTime = null;
            user.state = HandoffUserState.agent;
            user.agentReference = agentReference;
            await this.save(user);
            return Promise.resolve(user);
        } else {
            return Promise.resolve(null);
        }
    }

    async disconnectFromAgent(agentReference: ConversationReference) {
        const user = await this.findByAgent(agentReference);
        user.state = HandoffUserState.bot;
        user.queueTime = null;
        await this.save(user);
        return Promise.resolve(user);
    }

    getQueue() {
        return Promise.resolve(this.backingStore.filter(u => u.state === HandoffUserState.queued));
    }
}
