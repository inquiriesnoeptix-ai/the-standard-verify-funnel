const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const fs = require('fs');

// ─────────────────────────────────────────────
// CONFIG — edit these to match your server
// ─────────────────────────────────────────────
const CONFIG = {
  token: process.env.DISCORD_TOKEN,                // set in .env
  killLogChannelId: '1443535884111843329',
  announcementsChannelId: '1443535559321587773',
  dataFile: './logs.json',                          // where user data is saved

  // Role IDs + day thresholds
  roles: [
    { days: 3,   id: '1477792169304657940', label: '3 Day Log Streak'   },
    { days: 7,   id: '1477790348695699709', label: '7 Day Log Streak'   },
    { days: 14,  id: '1477790995247792139', label: '14 Day Log Streak'  },
    { days: 30,  id: '1477790349534429397', label: '30 Day Log Streak'  },
    { days: 50,  id: '1477792167102779514', label: '50 Day Log Streak'  },
    { days: 100, id: '1477792166112919714', label: '100 Day Log Streak' },
  ],
};

// ─────────────────────────────────────────────
// DATA — persists user log counts to disk
// ─────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(CONFIG.dataFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.dataFile, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load data:', e);
  }
  return {};
}

function saveData(data) {
  try {
    fs.writeFileSync(CONFIG.dataFile, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save data:', e);
  }
}

// ─────────────────────────────────────────────
// PATTERN CHECK — is this a valid log?
// ONLY tick/cross lines allowed — no random text
// Every non-empty line must be a tick or cross
// ─────────────────────────────────────────────
function isValidKillLog(content) {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Must have at least 3 lines
  if (lines.length < 3) return false;

  // Every single line must contain a tick or cross — no random text allowed
  const allLinesAreLog = lines.every(line =>
    line.includes('✔️') || line.includes('❌') ||
    line.includes('✅') || line.includes('✗') ||
    line.includes('☑') || line.includes('✓')
  );

  return allLinesAreLog;
}

// ─────────────────────────────────────────────
// ROLE ASSIGNMENT + ANNOUNCEMENT
// ─────────────────────────────────────────────
async function checkAndAssignRoles(member, totalDays, guild, announcementsChannel) {
  const newlyEarned = [];

  for (const roleConfig of CONFIG.roles) {
    if (totalDays === roleConfig.days) {
      // They just HIT this milestone exactly — assign role and announce
      try {
        const role = guild.roles.cache.get(roleConfig.id);
        if (role && !member.roles.cache.has(roleConfig.id)) {
          await member.roles.add(role);
          newlyEarned.push(roleConfig);
          console.log(`Assigned role "${roleConfig.label}" to ${member.user.tag}`);
        }
      } catch (e) {
        console.error(`Failed to assign role ${roleConfig.label}:`, e);
      }
    }
  }

  // Send announcement for each newly earned role
  for (const earned of newlyEarned) {
    try {
      const embed = new EmbedBuilder()
        .setColor(getRoleColor(earned.days))
        .setTitle(`🏆 ${earned.label} Achieved!`)
        .setDescription(
          `${member} has been logging consistently and just earned the **${earned.label}** role!\n\n` +
          `**${totalDays} days** of kill logs submitted. Keep it up! 🔥`
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: 'Daily Kill Log Tracker' });

      await announcementsChannel.send({ embeds: [embed] });
      console.log(`Announced role "${earned.label}" for ${member.user.tag}`);
    } catch (e) {
      console.error('Failed to send announcement:', e);
    }
  }
}

function getRoleColor(days) {
  if (days >= 100) return 0xFFD700; // Gold
  if (days >= 50)  return 0xFF4500; // Orange-red
  if (days >= 30)  return 0x9B59B6; // Purple
  if (days >= 14)  return 0x3498DB; // Blue
  if (days >= 7)   return 0x2ECC71; // Green
  return 0x95A5A6;                  // Grey (3 days)
}

// ─────────────────────────────────────────────
// BOT SETUP
// ─────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel],
});

client.once('ready', () => {
  console.log(`✅ Bot online as ${client.user.tag}`);
  console.log(`📋 Watching kill log channel: ${CONFIG.killLogChannelId}`);
  console.log(`📣 Announcing in channel: ${CONFIG.announcementsChannelId}`);
});

// ─────────────────────────────────────────────
// MESSAGE HANDLER
// ─────────────────────────────────────────────
client.on('messageCreate', async (message) => {
  // Ignore bots and messages outside the kill log channel
  if (message.author.bot) return;
  if (message.channel.id !== CONFIG.killLogChannelId) return;

  const content = message.content.trim();

  // ── VALID LOG ──
  if (isValidKillLog(content)) {
    const data = loadData();
    const userId = message.author.id;

    // Init user if first time
    if (!data[userId]) {
      data[userId] = {
        tag: message.author.tag,
        totalDays: 0,
        lastLogDate: null,
        logs: [],
      };
    }

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const lastLog = data[userId].lastLogDate;

    // Only count ONE log per day per user
    if (lastLog === today) {
      // Already logged today — react to acknowledge but don't double count
      try {
        await message.react('✅');
        await message.reply({
          content: `You've already logged today! Your current streak: **${data[userId].totalDays} days** 📊`,
          allowedMentions: { repliedUser: false },
        });
      } catch (e) {}
      return;
    }

    // Count this log
    data[userId].totalDays += 1;
    data[userId].lastLogDate = today;
    data[userId].tag = message.author.tag;
    data[userId].logs.push({
      date: today,
      messageId: message.id,
      content: content.slice(0, 200), // store first 200 chars
    });

    saveData(data);

    const totalDays = data[userId].totalDays;

    // React to confirm log counted
    try { await message.react('✅'); } catch (e) {}

    // Reply with current count
    try {
      await message.reply({
        content: `Log counted! 📋 You're on **${totalDays} day${totalDays !== 1 ? 's' : ''}** of logging.`,
        allowedMentions: { repliedUser: false },
      });
    } catch (e) {}

    // Check for role milestones
    try {
      const guild = message.guild;
      const member = await guild.members.fetch(userId);
      const announcementsChannel = guild.channels.cache.get(CONFIG.announcementsChannelId);

      if (announcementsChannel) {
        await checkAndAssignRoles(member, totalDays, guild, announcementsChannel);
      } else {
        console.error('Announcements channel not found. Check CONFIG.announcementsChannelId');
      }
    } catch (e) {
      console.error('Error during role check:', e);
    }

  // ── INVALID MESSAGE ──
  } else {
    // Delete the message and warn them
    try {
      await message.delete();
    } catch (e) {
      console.error('Could not delete message (missing permissions?):', e);
    }

    try {
      const warn = await message.channel.send({
        content: `${message.author} ❌ This channel is for kill logs only.\n\nA valid log looks like:\n\`\`\`\n✔️ - kill 1\n✔️ - kill 2\n❌ - death\n✔️ - kill 3\n\`\`\`\nRandom messages will be deleted.`,
      });

      // Auto-delete the warning after 8 seconds
      setTimeout(() => warn.delete().catch(() => {}), 8000);
    } catch (e) {
      console.error('Could not send warning:', e);
    }
  }
});

// ─────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────
client.login(CONFIG.token);
