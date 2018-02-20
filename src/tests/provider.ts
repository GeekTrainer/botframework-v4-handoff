import { ArrayHandoffProvider, HandoffUser, HandoffUserState } from "../handoff-middleware";
import sinon = require("sinon");
import { ConversationReference } from "botbuilder";
import { userReference, agentReference } from "./helpers";
import { assert } from "chai";

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