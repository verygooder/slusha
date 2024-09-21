import {
    Sticker,
    Update,
} from 'https://deno.land/x/grammy@v1.30.0/types.deno.ts';
import { ChatMessage } from './memory.ts';
import { Message } from 'https://deno.land/x/grammy_types@v3.14.0/message.ts';

export function getRandomInt(min: number, max: number) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); // The maximum is exclusive and the minimum is inclusive
}

export function stickerToText({ emoji }: Sticker): string {
    return emoji ? `[Sticker ${emoji}]` : '[Sticker]';
}

export function removeBotName(
    response: string,
    name: string,
    username: string,
) {
    const regexFull = new RegExp(`^${name}\\s*\\(@${username}\\):\\s*`, 'gmi');
    const regexName = new RegExp(`^${name}\\s*:\\s*`, 'gmi');
    response = response.replace(regexFull, '');
    return response.replace(regexName, '');
}

export function sliceMessage(message: string, maxLength: number): string {
    return message.length > maxLength
        ? message.slice(0, maxLength) + '...'
        : message;
}

interface HistoryOptions {
    simbolLimit?: number;
    usernames?: boolean;
}

export function makeHistoryString(
    history: ChatMessage[],
    { simbolLimit, usernames }: HistoryOptions = {},
): string {
    if (!simbolLimit) simbolLimit = 1000;
    if (!usernames) usernames = true;

    let result = '';
    for (let i = 0; i < history.length; i++) {
        const message = history[i];
        let context = `${message.sender.name} (@${message.sender.username}): `;
        if (!usernames) {
            context = `${message.sender.name}: `;
        }

        if (message.replyTo && !message.sender.myself) {
            // Add original message if this is last message in history
            if (i == history.length - 1) {
                const replyText = sliceMessage(
                    message.replyTo.text,
                    simbolLimit,
                );
                context +=
                    `(in reply to: ${message.replyTo.sender.name} > "${replyText}"): `;
            } else {
                context += `(in reply to: ${message.replyTo.sender.name}): `;
            }
        }

        context += sliceMessage(message.text, simbolLimit);

        result += context + '\n';
    }

    return result;
}

type ReplyMessage = Exclude<Message.CommonMessage['reply_to_message'], undefined>;

export function getText(
    msg:
        | Message
        | ReplyMessage,
) {
    let text = msg.text || '';

    if (msg.sticker) {
        text += stickerToText(msg.sticker);
    }

    if (msg.caption) {
        text += msg.caption;
    }

    // Replace new lines with spaces
    text = text.replace(/[\n\r]/g, ' ');

    if (!text.trim()) return;

    let name = '';
    switch (msg.forward_origin?.type) {
        case 'user':
            name = msg.forward_origin.sender_user.first_name ?? '';
            break;
        case 'chat':
            name = msg.forward_origin.sender_chat.first_name ??
                msg.forward_origin.sender_chat.title ?? '';
            break;
        case 'channel':
            name = msg.forward_origin.chat.first_name ??
                msg.forward_origin.chat.title ?? '';
            break;
        case 'hidden_user':
            name = 'hidden';
            break;
    }

    const from = `(forwarded from ${name.slice(0, 20)})`;
    text = `${from}: ${text}`;

    const attachments: (keyof (Message & Update.NonChannel))[] = [
        'photo',
        'video',
        'animation',
        'audio',
        'voice',
        'document',
        'video_note',
        'contact',
        'location',
        'venue',
        'poll',
        'dice',
        'game',
    ];

    const attachmentsText = attachments.reduce((acc, key) => {
        if (msg[key]) {
            acc += ` [${key}]`;
        }

        return acc;
    }, '');

    text += attachmentsText;

    return text;
}
