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

    public receiveActivity(context: Partial<BotContext>, next: () => Promise<void>) {
        if (!context.request || context.request.type !== "message" || !context.request.text) {
            return next();
        }

        if (context.conversationReference &&
            context.conversationReference.user &&
            context.conversationReference.user.name.toLocaleLowerCase().startsWith("agent")
        ) {
            return this.manageAgent(context, next)
        }

        const user = this.provider.findOrCreate(context.conversationReference);
        if(user.state === HandoffUserState.agent) {
            return context.bot.createContext(user.agentReference, (agentContext) => {
                agentContext.reply(context.request.text);
            });
        }
        switch (context.request.text.toLowerCase()) {
            // check for command
            case "agent":
                this.provider.queueForAgent(context.conversationReference);
                context.reply("Waiting for agent");
                return;
            case "cancel":
                this.provider.unqueueForAgent(context.conversationReference);
                context.reply("Connected to bot");
                return;
        }

        return next();
    }

    private manageAgent(context: Partial<BotContext>, next: () => Promise<void>) {
        const text = context.request.text.toLowerCase();

        // check if connected to user
        const connectedUser = this.provider.findByAgent(context.conversationReference);
        if(!connectedUser && text.indexOf("#") !== 0) return next();

        if (connectedUser) {
            // route message
            if (text === "#disconnect") {
                this.provider.disconnectFromAgent(context.conversationReference);
                context.reply("Reconnected to bot");
                return;
            } else if (text.indexOf("#") === 0) {
                context.reply("Command not valid when connected to user.");
                return;
            } else {
                return context.bot.createContext(connectedUser.userReference, (userContext) => {
                    userContext.reply(context.request.text);
                });
            }
        }

        // check for command
        switch (text.substring(1)) {
            case "list":
                const currentQueue = this.provider.getQueue();
                let message = "";
                currentQueue.forEach(u => message += "- " + u.userReference.user.name + "\n\n");
                context.reply(message);
                return;
            case "connect":
                // TODO: Reject if already connected
                const handoffUser = this.provider.connectToAgent(context.conversationReference);
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
    findOrCreate(userReference: ConversationReference): HandoffUser;
    save(user: HandoffUser): void;
    log(userReference: ConversationReference, from: string, text: string): HandoffUser;

    // Connection management
    findByAgent(agentReference: ConversationReference): HandoffUser;

    // Queue management
    queueForAgent(userReference: ConversationReference): HandoffUser;
    unqueueForAgent(userReference: ConversationReference): HandoffUser;
    connectToAgent(agentReference: ConversationReference): HandoffUser;
    disconnectFromAgent(agentReference: ConversationReference): HandoffUser;
    getQueue(): HandoffUser[];
}

export class ArrayHandoffProvider implements HandoffProvider {
    backingStore: HandoffUser[];

    constructor(backingStore: HandoffUser[] = []) {
        this.backingStore = backingStore;
    }

    // HandoffUser management
    findOrCreate(userReference: ConversationReference) {
        const results = this.backingStore.filter(u => u.userReference.user.id === userReference.user.id);
        if (results.length > 0) {
            return results[0];
        } else {
            const user: HandoffUser = {
                userReference: userReference,
                state: HandoffUserState.bot,
                messages: []
            };
            this.backingStore.unshift(user);
            this.save(user);
            return user;
        }
    }

    save(user: HandoffUser) {
        // Array doesn't need to be updated if object changes
        return;
    }

    log(userReference: ConversationReference, from: string, text: string) {
        let user = this.findOrCreate(userReference);
        user.messages.unshift({ from, text });
        this.save(user);
        return user;
    }

    findByAgent(agentReference: ConversationReference) {
        const result = this.backingStore.filter(u => u.agentReference && u.agentReference.user.id === agentReference.user.id);
        if (result.length > 0) return result[0];
        else return null;
    }

    // Queue management
    queueForAgent(userReference: ConversationReference) {
        const user = this.findOrCreate(userReference);
        user.state = HandoffUserState.queued;
        user.queueTime = new Date();
        this.save(user);
        return user;
    }

    unqueueForAgent(userReference: ConversationReference) {
        const user = this.findOrCreate(userReference);
        user.state = HandoffUserState.bot;
        user.queueTime = null;
        this.save(user);
        return user;
    }

    connectToAgent(agentReference: ConversationReference) {
        const results = this.backingStore.sort(u => u.queueTime.getTime());
        if (results.length > 0) {
            const user = results[0];
            user.queueTime = null;
            user.state = HandoffUserState.agent;
            user.agentReference = agentReference;
            this.save(user);
            return user;
        } else {
            return null;
        }
    }

    disconnectFromAgent(agentReference: ConversationReference) {
        const user = this.findByAgent(agentReference);
        user.state = HandoffUserState.bot;
        user.queueTime = null;
        this.save(user);
        return user;
    }

    getQueue() {
        return this.backingStore.filter(u => u.state === HandoffUserState.queued);
    }
}
