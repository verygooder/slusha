import { Chat as TgChat, Message, User } from 'grammy_types';
import logger from './logger.ts';
import { ReplyMessage } from './telegram/helpers.ts';
import { Character } from './charhub/api.ts';

export interface ReplyTo {
    id: number;
    text: string;
    info: ReplyMessage;
    isMyself: boolean;
}

export interface ChatMessage {
    id: number;
    text: string;
    replyTo?: ReplyTo;
    isMyself: boolean;
    info: Message;
}

export interface OptOutUser {
    id: number;
    username?: string;
    first_name: string;
}

export interface Member {
    id: number;
    username?: string;
    first_name: string;
    description: string;
    info: User;
    lastUse: number;
}

export interface BotCharacter extends Character {
    names: string[];
}

export interface Chat {
    notes: string[];
    lastNotes: number;
    lastMemory: number;
    history: ChatMessage[];
    memory?: string;
    lastUse: number;
    info: TgChat;
    chatModel?: string;
    character?: BotCharacter;
    optOutUsers: OptOutUser[];
    members: Member[];
    messagesToPass?: number;
    randomReplyProbability?: number;
    hateMode?: boolean;
}

export class Memory {
    chats: {
        [key: string]: Chat;
    };

    constructor(data?: NonFunctionProperties<Memory>) {
        if (!data) data = { chats: {} };
        this.chats = data.chats;
    }

    getChat(tgChat: TgChat) {
        let chat = this.chats[tgChat.id];

        if (!chat) {
            chat = {
                notes: [],
                lastNotes: 0,
                lastMemory: 0,
                history: [],
                lastUse: Date.now(),
                info: tgChat,
                optOutUsers: [],
                members: [],
            };

            this.chats[tgChat.id] = chat;
        }

        return chat;
    }

    save() {
        const jsonData = JSON.stringify(this);
        return Deno.writeTextFile('memory.json', jsonData);
    }
}

// Class avalivle when handling message
// with functionality specific to current chat
// like get previous messages from this user, get last notes, etc
export class ChatMemory {
    memory: Memory;
    chatInfo: TgChat;

    constructor(memory: Memory, chat: TgChat) {
        this.memory = memory;
        this.chatInfo = chat;
    }

    getChat() {
        return this.memory.getChat(this.chatInfo);
    }

    getHistory() {
        return this.getChat().history;
    }

    clear() {
        this.getChat().history = [];
        this.getChat().lastNotes = 0;
    }

    getLastMessage() {
        // TODO: Fix this
        return this.getHistory().slice(-1)[0];
    }

    addMessage(message: ChatMessage) {
        this.getHistory().push(message);
    }

    removeOldMessages(maxLength: number) {
        const history = this.getHistory();
        if (history.length > maxLength) {
            history.splice(0, maxLength);
        }
    }

    removeOldNotes(maxLength: number) {
        const notes = this.getChat().notes;
        if (notes.length > maxLength) {
            notes.splice(0, maxLength);
        }
    }

    updateUser(user: User) {
        const chat = this.getChat();
        if (!chat.members) {
            chat.members = [];
        }

        const member: Member = {
            id: user.id,
            username: user.username,
            first_name: user.first_name,
            info: user,
            description: '',
            lastUse: Date.now(),
        };

        const userIndex = chat.members.findIndex((u) => u.id === user.id);
        if (userIndex === -1) {
            chat.members.push(member);
        } else {
            chat.members[userIndex] = member;
        }
    }

    /**
     * Returns list of active members in chat
     * with last use less than 3 days ago
     * @returns Member[]
     */
    getActiveMembers(days = 7, limit = 10) {
        const chat = this.getChat();
        if (!chat.members) {
            return [];
        }

        const activeMembers = chat.members.filter((m) =>
            m.lastUse > Date.now() - 1000 * 60 * 60 * 24 * days
        );

        return activeMembers.slice(0, limit);
    }
}

type NonFunctionPropertyNames<T> = {
    // deno-lint-ignore ban-types
    [K in keyof T]: T[K] extends Function ? never : K;
}[keyof T];

type NonFunctionProperties<T> = Pick<T, NonFunctionPropertyNames<T>>;

export async function loadMemory(): Promise<Memory> {
    let data;
    try {
        data = await Deno.readTextFile('memory.json');
    } catch (error) {
        logger.warn('reading memory: ', error);
        return new Memory();
    }

    let parsedData: NonFunctionProperties<Memory>;
    try {
        parsedData = JSON.parse(data);
    } catch (error) {
        logger.warn('parsing memory: ', error);
        return new Memory();
    }

    return new Memory(parsedData);
}
