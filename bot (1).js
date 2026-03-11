const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

// ─── CONFIG ────────────────────────────────────────────────────────────────
const BOT_TOKEN    = 'YOUR_BOT_TOKEN_HERE';          // Replace with your bot token
const SUPABASE_URL = 'https://uohmshxaypofbdnuaiwj.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVvaG1zaHhheXBvZmJkbnVhaXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNjY2NDQsImV4cCI6MjA4ODc0MjY0NH0.32yA_vM19i_0K-e95qdXrY4dR6m_fTDsJaNXqfi7T4I';

// Optional: restrict commands to specific channel IDs (leave empty [] to allow everywhere)
const ALLOWED_CHANNELS = [];

// Optional: restrict commands to specific role names (leave empty [] to allow everyone)
const ADMIN_ROLES = [];
// ───────────────────────────────────────────────────────────────────────────

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// ─── SUPABASE HELPERS ──────────────────────────────────────────────────────
async function getUser(discordId) {
    const id = 'discord_' + discordId;
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(id)}&select=*`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return { id, data: rows[0].data };
}

async function setUser(discordId, data) {
    const id = 'discord_' + discordId;
    await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ id, data })
    });
}
// ───────────────────────────────────────────────────────────────────────────

function hasAdminPermission(member) {
    if (ADMIN_ROLES.length === 0) return true;
    return member.roles.cache.some(r => ADMIN_ROLES.includes(r.name));
}

function isAllowedChannel(channelId) {
    if (ALLOWED_CHANNELS.length === 0) return true;
    return ALLOWED_CHANNELS.includes(channelId);
}

function parseArgs(content, command) {
    // e.g. "?deposit @user 500" or "?deposit 123456789 500"
    const withoutCmd = content.slice(command.length).trim();
    const mentionMatch = withoutCmd.match(/^<@!?(\d+)>\s+(\d+)$/);
    if (mentionMatch) return { userId: mentionMatch[1], amount: parseInt(mentionMatch[2]) };
    const rawMatch = withoutCmd.match(/^(\d{17,20})\s+(\d+)$/);
    if (rawMatch) return { userId: rawMatch[1], amount: parseInt(rawMatch[2]) };
    return null;
}

// ─── EVENTS ────────────────────────────────────────────────────────────────
client.once('ready', () => {
    console.log(`✅ BSS Bot online as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('?')) return;
    if (!isAllowedChannel(message.channel.id)) return;

    const content = message.content.trim();
    const isDeposit  = content.toLowerCase().startsWith('?deposit');
    const isWithdraw = content.toLowerCase().startsWith('?withdraw');
    const isBalance  = content.toLowerCase().startsWith('?balance');
    const isHelp     = content.toLowerCase().startsWith('?help');

    // ── ?help ──────────────────────────────────────────────────────────────
    if (isHelp) {
        return message.reply({
            embeds: [{
                color: 0x5865F2,
                title: '🎰 BSS Gambling Bot — Commands',
                fields: [
                    { name: '?deposit @user <amount>',  value: 'Give coins to a user' },
                    { name: '?withdraw @user <amount>', value: 'Remove coins from a user' },
                    { name: '?balance @user',           value: 'Check a user\'s coin balance' },
                ],
                footer: { text: 'BSS Gambling' }
            }]
        });
    }

    // ── ?balance ───────────────────────────────────────────────────────────
    if (isBalance) {
        const withoutCmd = content.slice('?balance'.length).trim();
        const mentionMatch = withoutCmd.match(/^<@!?(\d+)>$/);
        const rawMatch     = withoutCmd.match(/^(\d{17,20})$/);
        const targetId = mentionMatch ? mentionMatch[1] : rawMatch ? rawMatch[1] : null;

        if (!targetId) {
            return message.reply('❌ Usage: `?balance @user`');
        }

        try {
            const user = await getUser(targetId);
            if (!user || !user.data) {
                return message.reply('❌ That user has no account on BSS Gambling yet.');
            }
            const coins = Math.floor(user.data.chips ?? 0);
            const name  = user.data.displayName || `discord_${targetId}`;
            return message.reply({
                embeds: [{
                    color: 0x0fd68a,
                    title: '💰 Balance',
                    description: `**${name}** has **${coins.toLocaleString()} ⭐ coins**`,
                    footer: { text: 'BSS Gambling' }
                }]
            });
        } catch (e) {
            console.error(e);
            return message.reply('❌ Failed to fetch balance. Try again.');
        }
    }

    // ── ?deposit / ?withdraw ───────────────────────────────────────────────
    if (!isDeposit && !isWithdraw) return;

    // Permission check
    if (!hasAdminPermission(message.member)) {
        return message.reply('❌ You don\'t have permission to use this command.');
    }

    const command = isDeposit ? '?deposit' : '?withdraw';
    const args = parseArgs(content, command);

    if (!args) {
        return message.reply(`❌ Usage: \`${command} @user <amount>\`\nExample: \`${command} @John 500\``);
    }

    if (args.amount <= 0 || isNaN(args.amount)) {
        return message.reply('❌ Amount must be a positive number.');
    }

    if (args.amount > 1_000_000) {
        return message.reply('❌ Maximum amount per transaction is 1,000,000 coins.');
    }

    try {
        const user = await getUser(args.userId);

        if (!user || !user.data) {
            return message.reply('❌ That user has no account on BSS Gambling yet. They need to log in first.');
        }

        const before = Math.floor(user.data.chips ?? 0);

        if (isWithdraw && before < args.amount) {
            return message.reply(`❌ **${user.data.displayName || args.userId}** only has **${before.toLocaleString()} ⭐** — not enough to withdraw **${args.amount.toLocaleString()} ⭐**.`);
        }

        const after = isDeposit ? before + args.amount : before - args.amount;
        user.data.chips = after;
        await setUser(args.userId, user.data);

        const emoji  = isDeposit ? '📥' : '📤';
        const action = isDeposit ? 'deposited to' : 'withdrawn from';
        const color  = isDeposit ? 0x0fd68a : 0xe74c3c;
        const name   = user.data.displayName || `discord_${args.userId}`;

        return message.reply({
            embeds: [{
                color,
                title: `${emoji} ${isDeposit ? 'Deposit' : 'Withdraw'} Successful`,
                fields: [
                    { name: 'User',       value: name,                                 inline: true },
                    { name: 'Amount',     value: `${args.amount.toLocaleString()} ⭐`, inline: true },
                    { name: 'Before',     value: `${before.toLocaleString()} ⭐`,      inline: true },
                    { name: 'After',      value: `${after.toLocaleString()} ⭐`,       inline: true },
                    { name: 'Done by',    value: `<@${message.author.id}>`,            inline: true },
                ],
                footer: { text: 'BSS Gambling' },
                timestamp: new Date().toISOString()
            }]
        });

    } catch (e) {
        console.error(e);
        return message.reply('❌ Something went wrong. Check the console for details.');
    }
});

client.login(BOT_TOKEN);
