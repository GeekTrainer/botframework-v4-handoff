import { error } from "util";
import { assert } from "chai";
import { TestAdapter, MiddlewareSet, ConversationReference, ChannelAccount, Activity, ActivityTypes, Bot, TemplateManager, ConversationResourceResponse } from "botbuilder";
import { ArrayHandoffProvider, HandoffMiddleware, HandoffProvider, HandoffUser, HandoffUserState } from './handoff-middleware'
import { createBot } from './bot';
import * as sinon from 'sinon';
import { create } from "domain";

class TestContext implements BotContext {
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

const getConversationReference = (id: string, name: string) => {
    return { user: { id, name } } as ConversationReference;
}

const userReference = getConversationReference("user", "user");

const agentReference = getConversationReference("agent", "agent");

describe("Agent management", () => {
    let next: sinon.SinonStub;

    const getProvider = (state: HandoffUserState, agentReference: ConversationReference = null) => {
        let provider = sinon.createStubInstance<ArrayHandoffProvider>(ArrayHandoffProvider);
        switch(state) {
            case HandoffUserState.queued:
                provider.getQueue.returns([{
                    userReference: userReference,
                    messages: [],
                    state: HandoffUserState.queued,
                    queueTime: new Date()
                }]);
                provider.connectToAgent.returns({
                    userReference: userReference,
                    messages: [],
                    state: HandoffUserState.agent
                });
                break;
            case HandoffUserState.agent:
                provider.findByAgent.returns({
                    userReference: userReference,
                    message: [],
                    state: HandoffUserState.agent,
                    agentReference: agentReference
                });
                break;                        
        }
        return provider;
    }

    beforeEach(() => {
        next = sinon.stub();
    });

    it("Logs messages from agent when connected to user", async () => {
        const context = new TestContext(agentReference, "Hi there");
        const provider = getProvider(HandoffUserState.agent, agentReference);

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(provider.log.calledWith(provider.findByAgent(agentReference), agentReference.user.name, "Hi there"), "Log not called");
    });

    it("Routes message to bot when agent not connected", async () => {
        const context = new TestContext(agentReference, "Hi there");
        const provider = getProvider(HandoffUserState.bot);

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(next.called, "next not called");
    });

    it("Agent can list queue", async () => {
        const context = new TestContext(agentReference, "#list");
        const provider = getProvider(HandoffUserState.queued);

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(provider.getQueue.called, "getQueue not called");
        assert(next.notCalled, "next called");
        assert(context.responses.length === 1, "Wrong number of responses");
        assert(context.responses[0].text.indexOf(userReference.user.name) > -1, "Name not listed")
    });

    it("Agent can connect to longest waiting user", async () => {
        const context = new TestContext(agentReference, "#connect");
        const provider = getProvider(HandoffUserState.queued);

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(next.notCalled, "next called");
        assert(context.responses.length === 1, "Wrong number of responses");
        assert(context.responses[0].text.indexOf(userReference.user.name) > -1, "Name not listed")
    });

    it("Agent receives error when calling connect when connected", async () => {
        const context = new TestContext(agentReference, "#connect");
        const provider = getProvider(HandoffUserState.agent);

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(context.responses.length === 1, "Wrong number of responses");
        assert(context.responses[0].text === "Command not valid when connected to user.", "wrong message");
        assert(next.notCalled, "next was called");
    });

    it("Sends error message when no users are queued", async () => {
        const context = new TestContext(agentReference, "#connect");
        const provider = getProvider(HandoffUserState.bot);

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(context.responses.length === 1, "Wrong number of responses");
        assert(context.responses[0].text === "Nobody in the queue.", "wrong message");
        assert(next.notCalled, "next was called");
    });

    it("Routes messages to user when connected", async () => {
        const context = new TestContext(agentReference, "Hello user!");
        const provider = getProvider(HandoffUserState.agent);
        const user = provider.findByAgent(context.conversationReference);
        const createContextSpy = sinon.spy(context.bot, "createContext")

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(createContextSpy.calledWith(user.userReference), "createContext not called with correct reference");
        assert(context.responses.length === 1, "Wrong number of responses");
        assert(context.responses[0].text === "Hello user!", "Wrong message");
        assert(provider.findByAgent.called, "findByAgent not called");
        assert(next.notCalled, "next called");
    });

    it("Disconnects user", async () => {
        const context = new TestContext(agentReference, "#disconnect");
        const provider = getProvider(HandoffUserState.agent);

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(provider.disconnectFromAgent.called, "Disconnect not called");
        assert(context.responses.length === 1, "No messages received");
        assert(context.responses[0].text === "Reconnected to bot", "wrong message");
        assert(next.notCalled, "next called");
    });
});

describe("User management", () => {
    let next: sinon.SinonStub;
   
    const createUser = (state: HandoffUserState) => {
        return {
            userReference,
            agentReference,
            messages: [],
            state
        } as HandoffUser   
    }

    beforeEach(() => {
        next = sinon.stub();
    });

    it("Logs messages", async () => {
        const next = sinon.stub();
        const provider = sinon.createStubInstance<ArrayHandoffProvider>(ArrayHandoffProvider);
        provider.findOrCreate.returns(createUser(HandoffUserState.bot));
        provider.log.returns(createUser(HandoffUserState.bot));
        const context = new TestContext(userReference, "Let's log");

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(provider.log.called, "Log not called");
    });

    it("Adds user to queue", async () => {
        const next = sinon.stub();
        const provider = sinon.createStubInstance<ArrayHandoffProvider>(ArrayHandoffProvider);
        provider.findOrCreate.returns(createUser(HandoffUserState.bot));
        const context = new TestContext(userReference, "agent");

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(provider.findOrCreate.calledWith(userReference), "findOrCreate not called");
        assert(provider.queueForAgent.calledWith(userReference), "queueForAgent not called");
        assert(context.responses[0].text === "Waiting for agent", "Wrong message");
    });

    it("Removes user from queue", async () => {
        const next = sinon.stub();
        const provider = sinon.createStubInstance<ArrayHandoffProvider>(ArrayHandoffProvider);
        provider.findOrCreate.returns(createUser(HandoffUserState.queued));

        const context = new TestContext(userReference, "cancel");

        await new HandoffMiddleware(provider).receiveActivity(context, next);

        assert(provider.findOrCreate.calledWith(userReference), "findOrCreate not called");
        assert(provider.unqueueForAgent.calledWith(userReference), "unqueueForAgent not called");
        assert(context.responses[0].text === "Connected to bot", "wrong message");
    });

    it("Routes messages to agent when connected", async () => {
        const next = sinon.stub();
        const provider = sinon.createStubInstance<ArrayHandoffProvider>(ArrayHandoffProvider);
        provider.findByAgent.returns(createUser(HandoffUserState.agent));
        provider.findOrCreate.returns(createUser(HandoffUserState.agent));

        const context = new TestContext(userReference, "Hello, agent");
        const createContextSpy = sinon.spy(context.bot, "createContext");

        await (new HandoffMiddleware(provider)).receiveActivity(context, next);

        assert(provider.findOrCreate.called, "findOrCreate not called");
        assert(createContextSpy.calledWith(createUser(HandoffUserState.queued).agentReference), "Create context not called");
        assert(context.responses[0].text = "Hello, agent", "Message incorrect");
    });
});

describe("Provider manages users", () => {
    let provider: ArrayHandoffProvider = null;
    let backingStore: HandoffUser[];
    const sandbox = sinon.createSandbox();

    beforeEach(() => {
        backingStore = [];
        provider = new ArrayHandoffProvider(backingStore);
        sandbox.spy(provider, "save");
        sandbox.spy(provider, "findOrCreate");
    });

    afterEach(() => {
        sandbox.restore();
    });

    const assertSave = (user: HandoffUser) => {
        sandbox.assert.calledWith(provider.save as sinon.SinonSpy, user);
    }

    const assertFindOrCreate = (reference: ConversationReference = userReference) => {
        sandbox.assert.calledWith(provider.findOrCreate as sinon.SinonSpy, reference);        
    }

    const createUser = (state: HandoffUserState, agentReference: ConversationReference = null) => {
        const user: HandoffUser = {
            userReference,
            state,
            queueTime: state === HandoffUserState.queued ? new Date() : null,
            messages: [],
            agentReference
        };
        backingStore.push(user);
        return user;
    }

    it("Creates new users", async () => {
        const user = await provider.findOrCreate(userReference);

        assertSave(user);
    });

    
    it("Returns existing users", async () => {
        const expected = await provider.findOrCreate(userReference);
        const actual = await provider.findOrCreate(userReference);
    
        assert(expected.userReference.user.id === actual.userReference.user.id);
    });

    it("Doesn't add an existing user", async () => {
        await provider.findOrCreate(userReference);
        await provider.findOrCreate(userReference);
        await provider.findOrCreate(userReference);

        assert(backingStore.length === 1);
    });

    it("Logs message", async () => {
        // TODO: Create multiple messages??
        const message = {
            from: "from",
            text: "test message"
        };

        const user = createUser(HandoffUserState.bot);
        const actual = await provider.log(user, message.from, message.text);

        assertSave(user);
        assert(actual.messages.length === 1);
        assert(actual.messages[0].text = message.text);
        assert(actual.messages[0].from = message.from);
    });

    it("Queues user for agent", async () => {
        const user = await provider.queueForAgent(userReference);

        const actual = backingStore[0];
        
        assert(actual.state === HandoffUserState.queued);
        assert(actual.queueTime);
    });

    it("Unqueues user for agent", async () => {
        const user = createUser(HandoffUserState.queued);

        const actual = await provider.unqueueForAgent(userReference);
        assertSave(user);
        assertFindOrCreate();
        assert(actual.state === HandoffUserState.bot);
        assert(!actual.queueTime, "Queuetime not reset");
        assert(user.state === HandoffUserState.bot);
    });

    it("Connects to agent", async () => {
        createUser(HandoffUserState.queued);
        const actual = await provider.connectToAgent(agentReference);
        assertSave(actual);
        assert(actual.state === HandoffUserState.agent, "state not set to agent");
        assert(!actual.queueTime, "queueTime not reset");
        assert(actual.agentReference.user.id === agentReference.user.id, "Agent id not correct");
        assert(actual.agentReference.user.name === agentReference.user.name, "Agent name not correct");
    });

    it("Connects longest queued user to agent", async () => {
        createUser(HandoffUserState.queued);
        const expected = createUser(HandoffUserState.queued);
        expected.queueTime = new Date(2017, 2, 1);

        const actual = await provider.connectToAgent(agentReference);
        assertSave(actual);
        assert(actual.state === HandoffUserState.agent, "state not set to agent");
        assert(!actual.queueTime, "queueTime not reset");
        assert(actual.agentReference.user.id === agentReference.user.id, "Agent id not correct");
        assert(actual.agentReference.user.name === agentReference.user.name, "Agent name not correct");
    });

    it("Returns null if no users are queued", async () => {
        const actual = await provider.connectToAgent(agentReference);

        assert(!actual, "User returned");
    });

    it("Returns queued users", async () => {
        createUser(HandoffUserState.bot);
        const expectedUser = createUser(HandoffUserState.queued);

        const actual = await provider.getQueue();

        assert(actual.length === 1, "Too many users returned");
        assert(actual[0].userReference.user.id === expectedUser.userReference.user.id, "Wrong user returned");
    });

    it("Returns user when connected to agent", async () => {
        const user = createUser(HandoffUserState.agent, agentReference);
        
        const actual = await provider.findByAgent(agentReference);

        assert(actual.agentReference.user.id === agentReference.user.id, "Wrong agent");
    });

    it("Returns null if nobody connected to user", async () => {
        const user = createUser(HandoffUserState.agent);
        
        const actual = await provider.findByAgent(agentReference);

        assert(!actual, "User loaded when null should have been returned");
    });

    it("Disconnects user", async () => {
        createUser(HandoffUserState.agent, agentReference);

        const actual = await provider.disconnectFromAgent(agentReference);

        assert(actual.state === HandoffUserState.bot, "state not updated");
        assert(!actual.queueTime, "queueTime not reset");
        assertSave(actual);
    });
});