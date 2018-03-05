import * as mongoose from "mongoose";
import * as provider from "../mongo-provider";
import { assert } from "chai";

describe("Data structure", () => {
    beforeEach(() => {
        // (mongoose as any).models = {};
    })
    // it("conversationAccountSchema requires all properties", (done) => {
    //     const conversationAccountModel = model("ConversationAccount", conversationAccountSchema);
    //     const testObject = new conversationAccountModel({});
    //     testObject.validate((reason) => {
    //         assert(reason.errors.name);
    //         assert(reason.errors.id);
    //         assert(reason.errors.isGroup);
    //         done();
    //     });
    // });

    it("conversationAccountSchema requires all properties", (done) => {
        // const channelAccountModel = model("ChannelAccount", channelAccountSchema);
        // const testObject = new channelAccountModel({});
        const testObject = createObject("channelAccount", {});
        testObject.validate((reason: any) => {
            assert(reason.errors.name);
            assert(reason.errors.id);
            done();
        });
    });
});

const createObject = (schemaName: string, data: any = {}) => {
    let model: mongoose.Model<any>;
    try {
        mongoose.model(schemaName);
    } catch {
        model = mongoose.model(schemaName, require("../mongo-provider")[schemaName + "Schema"]);
    }
    return new model(data);
}