import { Document, Schema, model } from 'mongoose';
import { HandoffProvider, HandoffUser } from './handoff-middleware';
import { ConversationReference } from 'botbuilder';

interface HandoffUserDocument extends Document {}

export const conversationAccountSchema = new Schema({
    isGroup: { type: Boolean, required: true },
    id: { type: String, required: true },
    name: { type: String, required: true }
}, {
    id: false,
    strict: false,
    _id: false
});

export const channelAccountSchema = new Schema({
    id: { type: String, required: true },
    name: { type: String, required: true }
}, {
    id: false,
    strict: false,
    _id: false
});

const conversationReferenceSchema = new Schema({
    activityId: { type: String, required: false },
    user: { type: channelAccountSchema, required: false },
    bot: { type: channelAccountSchema, required: true },
    conversation: { type: conversationAccountSchema, required: true },
    channelId: { type: String, required: true },
    serviceUrl: { type: String, required: true },
});

const handoffUserSchema = new Schema({
    queueTime: { type: Date, required: false},
    messages: [{
        text: String,
        from: String
    }],
    userReference: { type: conversationReferenceSchema, required: true },
    agentReference: { type: conversationReferenceSchema, required: false }
});

const HandoffUserModel =  model<HandoffUserDocument>("HandoffUser", handoffUserSchema);

export class MongoDBProvider implements Partial<HandoffProvider> {
    async findOrCreate(userReference: ConversationReference) {
        let user = await HandoffUserModel.findOne({'userReference.user.id': userReference.user.id});
        if(user) {
            return Promise.resolve(user.toObject() as HandoffUser);
        } else {
            return Promise.resolve((await HandoffUserModel.create({
                messages: [],
                userReference,
            })).toObject() as HandoffUser);
        }
    };
}