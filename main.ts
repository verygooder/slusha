import Werror from './lib/werror.ts';
import logger from './lib/logger.ts';
import resolveConfig, { Config } from './lib/config.ts';
import setupBot from './lib/telegram/setup-bot.ts';
import { ChatMemory, ChatMessage, loadMemory } from './lib/memory.ts';

import { generateText } from 'npm:ai';
import { google } from 'npm:@ai-sdk/google';

import {
    deleteOldFiles,
    getRandomNepon,
    getText,
    makeHistory,
    probability,
    removeBotName,
    sliceMessage,
    testMessage,
} from './lib/helpers.ts';
import { replyWithMarkdown } from './lib/telegram/tg-helpers.ts';
import { limit } from 'https://deno.land/x/grammy_ratelimiter@v1.2.0/mod.ts';

const memory = await loadMemory();

let config: Config;
try {
    config = await resolveConfig();
} catch (error) {
    logger.error('Config error: ', error);
    Deno.exit(1);
}

const bot = setupBot(config);

bot.on('message', (ctx, next) => {
    // Init custom context
    ctx.memory = memory;
    ctx.m = new ChatMemory(memory, ctx.chat);
    ctx.info = { isRandom: false };

    // Save all messages to memory
    let replyTo: ChatMessage['replyTo'] | undefined;
    if (ctx.msg.reply_to_message && ctx.msg.reply_to_message.from) {
        replyTo = {
            id: ctx.msg.reply_to_message.message_id,
            sender: {
                id: ctx.msg.reply_to_message.from.id,
                name: ctx.msg.reply_to_message.from.first_name,
                username: ctx.msg.reply_to_message.from.username,
            },
            text: getText(
                ctx.msg.reply_to_message,
            ) ?? '',
            photo: ctx.msg.reply_to_message.photo,
            media_group_id: ctx.msg.reply_to_message.media_group_id,
        };
    }

    // Save every message to memory
    ctx.m.addMessage({
        id: ctx.msg.message_id,
        sender: {
            id: ctx.msg.from.id,
            name: ctx.msg.from.first_name,
            username: ctx.msg.from.username,
        },
        replyTo,
        date: ctx.msg.date,
        text: getText(ctx.msg) ?? '',
        isSummary: false,
        info: ctx.message,
    });

    ctx.m.removeOldMessages(config.historyMaxLength);

    return next();
});

bot.command('start', (ctx) => ctx.reply(config.startMessage));

bot.command('forget', async (ctx) => {
    ctx.m.clear();
    await ctx.reply('История очищена');
});

bot.command('model', (ctx) => {
    // Check if user is admin
    if (
        !config.adminIds || !ctx.msg.from ||
        !config.adminIds.includes(ctx.msg.from.id)
    ) {
        return;
    }

    const args = ctx.msg.text.split(' ').map((arg) => arg.trim()).filter((
        arg,
    ) => arg !== '');

    // If no parameter is passed, show current model
    if (args.length === 1) {
        return ctx.reply(ctx.m.getChat().chatModel ?? config.ai.model);
    }

    // If parameter is passed, set new model
    const newModel = args[1];
    if (newModel === 'default') {
        ctx.m.getChat().chatModel = undefined;
        return ctx.reply('Model reset');
    }
    
    ctx.m.getChat().chatModel = newModel;
    return ctx.reply(`Model set to ${newModel}`);
});

bot.use(limit(
    {
        // Allow only 1 message to be handled every 2 seconds.
        timeFrame: 2000,
        limit: 1,

        // This is called when the limit is exceeded.
        onLimitExceeded: () => {
            logger.warn('Skipping message because rate limit exceeded');
        },

        keyGenerator: (ctx) => {
            if (ctx.hasChatType(['group', 'supergroup'])) {
                return ctx.chat.id.toString();
            }

            return ctx.from?.id.toString();
        },
    },
));

// Decide if we should reply to user
bot.on('message', (ctx, next) => {
    const msg = ctx.m.getLastMessage();

    // Ignore if text is empty
    if (!msg.text) {
        return;
    }

    // Direct reply to bot
    if (ctx.msg.reply_to_message?.from?.id === bot.botInfo.id) {
        logger.info('Direct reply to bot');
        return next();
    }

    // Direct message
    if (ctx.msg.chat.type === 'private') {
        logger.info('Direct message');
        return next();
    }

    // Mentined bot's name
    if (new RegExp(`(${config.names.join('|')})`, 'gmi').test(msg.text)) {
        logger.info("Replying because of mentioned bot's name");
        return next();
    }

    if (
        testMessage(config.tendToReply, msg.text) &&
        probability(config.tendToReplyProbability)
    ) {
        logger.info(
            `Replying because of tend to reply "${sliceMessage(msg.text, 50)}"`,
        );
        ctx.info.isRandom = true;
        return next();
    }

    if (
        testMessage(config.tendToIgnore, msg.text) &&
        probability(config.tendToIgnoreProbability)
    ) {
        logger.info(
            `Ignoring because of tend to ignore "${
                sliceMessage(msg.text, 50)
            }"`,
        );
        return;
    }

    if (probability(config.randomReplyProbability)) {
        logger.info('Replying because of random reply probability');
        ctx.info.isRandom = true;
        return next();
    }
});

// Get response from AI
bot.on('message', async (ctx) => {
    const messages = await makeHistory(
        bot,
        logger,
        ctx.m.getHistory(),
        {
            messagesLimit: config.ai.messagesToPass,
            symbolLimit: config.ai.messageMaxLength,
        },
    );

    messages.unshift({
        role: 'system',
        content: config.ai.prompt,
    });

    messages.push({
        role: 'user',
        content: config.ai.finalPrompt,
    });

    const time = new Date().getTime();

    const model = ctx.m.getChat().chatModel ?? config.ai.model;

    let response;
    try {
        response = await generateText({
            model: google(
                model,
                {
                    safetySettings: [
                        {
                            category: 'HARM_CATEGORY_HARASSMENT',
                            threshold: 'BLOCK_NONE',
                        },
                        {
                            category: 'HARM_CATEGORY_HATE_SPEECH',
                            threshold: 'BLOCK_NONE',
                        },
                        {
                            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
                            threshold: 'BLOCK_NONE',
                        },
                        {
                            category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
                            threshold: 'BLOCK_NONE',
                        },
                    ],
                },
            ),
            messages,
            temperature: config.ai.temperature,
            topK: config.ai.topK,
            topP: config.ai.topP,
        });
    } catch (error) {
        logger.error('Could not get response: ', error);

        if (!ctx.info.isRandom) {
            await ctx.reply(getRandomNepon(config));
        }
        return;
    }

    const title = ctx.chat.title ?? ctx.chat.first_name;
    const username = ctx.chat.username ?? '';
    logger.info(
        'Time to get response:',
        (new Date().getTime() - time) / 1000,
        `for "${title}" (@${username})`,
    );

    let replyText = response.text;

    replyText = removeBotName(
        replyText,
        bot.botInfo.first_name,
        bot.botInfo.username,
    );

    // Remove emojis if message has text
    const textSansEmojis = replyText.replace(
        /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g,
        '',
    );
    if (textSansEmojis.trim().length > 0) {
        replyText = textSansEmojis;
    }

    // Delete first line if it ends with "):"
    const replyLines = replyText.split('\n');
    const firstLint = replyLines[0];
    if (firstLint.match(/^.*\)\s*:\s*$/)) {
        replyText = replyLines.slice(1).join('\n');
        logger.info('Deleted first line because it ends with "):"');
    }

    replyText = replyText.trim();

    logger.info('Response:', replyText);

    if (replyText.length === 0) {
        logger.warn(
            `Empty response from AI: "${response.text}" => "${replyText}"`,
        );

        if (!ctx.info.isRandom) {
            await ctx.reply(getRandomNepon(config));
        }

        return;
    }

    let replyInfo;
    try {
        replyInfo = await replyWithMarkdown(ctx, replyText);
    } catch (error) {
        logger.error('Could not reply to user: ', error);

        if (!ctx.info.isRandom) {
            await ctx.reply(getRandomNepon(config));
        }
        return;
    }

    // Save bot's reply
    ctx.m.addMessage({
        id: replyInfo.message_id,
        sender: {
            id: bot.botInfo.id,
            name: bot.botInfo.first_name,
            username: bot.botInfo.username,
            myself: true,
        },
        date: replyInfo.date,
        text: replyText,
        isSummary: false,
        info: ctx.message,
    });
});

void bot.start();

// Save memory every minute
setInterval(async () => {
    try {
        await memory.save();
    } catch (error) {
        logger.error('Could not save memory: ', error);
    }
}, 60 * 1000);

// Delete old files every hour
setInterval(async () => {
    try {
        await deleteOldFiles(logger, config.filesMaxAge);
    } catch (error) {
        logger.error('Could not delete old files: ', error);
    }
}, 60 * 60 * 1000);

// Save memory on exit
Deno.addSignalListener('SIGINT', async () => {
    try {
        await memory.save();
        logger.info('Memory saved on exit');
    } catch (error) {
        throw new Werror(error, 'Saving memory on exit');
    } finally {
        Deno.exit();
    }
});
