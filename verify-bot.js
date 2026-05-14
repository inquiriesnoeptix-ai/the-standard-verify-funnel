const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN_VERIFY;
const VERIFIED_ROLE_ID = "1443889532956053525";
const OWNER_ID = "1348246749596094474";
const KICK_DAY = 0; // Sunday
const KICK_HOUR = 9;
const FIRST_DM_DELAY = 10 * 60 * 1000; // 10 minutes
const REMINDER_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const KICK_THRESHOLD_DAYS = 7;

// ─── INACTIVITY CONFIG ────────────────────────────────────────────────────────
const INACTIVITY_WARNING_1_DAYS = 0.000347; // 30 seconds
const INACTIVITY_WARNING_2_DAYS = 11;  // Second warning at 11 days
const INACTIVITY_KICK_DAYS = 14;       // Kicked at 14 days (fortnightly Sunday)

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ],
});

// Track last message timestamp per verified member
const lastMessageTime = new Map();

const reminderCounts = new Map();
const pendingTimers = new Map();

// ─── UNVERIFIED DM MESSAGES ───────────────────────────────────────────────────

const FIRST_DM = `You joined the server. You haven't verified.

Let me be clear — this isn't a place to lurk. You either step in or you step out. There is no middle ground here.

Right now you're taking up space that someone who actually wants to be here could use.

**Here's what you need to do:**
1. Read **#read-me** — understand what this place is
2. Read **#rules** — understand the standard
3. Read **#orientation-map** — understand the system
4. Read **#start-here** — understand what's expected
5. Go to **#verification** and click the **VERIFY** button

That's it. 5 steps. Takes less than 10 minutes.

If you can't do that, this isn't the place for you. And that's not an insult — it's just the truth.`;

const REMINDER_DMS = [
  `Still not verified.

You've been in the server for over a day now and you haven't done the one thing that was asked of you — verify.

You know what that tells me? You're the same person in here that you are out there. Someone who knows what to do but doesn't do it.

Go to **#verification**. Click the button. Or don't — but understand that we remove people who don't show up.`,

  `Day 2. Still nothing.

I'm not going to sugarcoat this. You joined a community built on execution and you've executed nothing. Not even a button click.

If you need the steps again, type **"how do I verify"** and I'll send them.

Otherwise — go to **#verification** and handle it. The kick wave runs every Sunday. The clock is ticking.`,

  `3 days. No verification. No action. No proof you belong here.

This is your last friendly reminder. After this I stop asking nicely.

**#verification** → click VERIFY. That's all it takes.

If you can't commit to clicking one button, how are you going to commit to changing your life?`,

  `You're still here. Still unverified. Still proving nothing.

Sunday morning the kick wave runs. Unverified members get removed. No exceptions. No second chances after that.

This is not a threat. It's the standard. Either meet it or accept that you weren't ready.

**#verification** → VERIFY. Last chance.`,
];

const KICK_DM = `You were removed from The Vault of N.

Not because we don't want you here. Because you didn't want to be here enough to verify.

You had a full week. Multiple reminders. One button to click. And you chose not to.

That's not punishment — that's alignment. We only keep people who show up.

If you ever decide you're actually ready, you know where to find us.`;

const HOW_TO_VERIFY = `Here's exactly how to verify — no excuses:

**Step 1:** Go to **#read-me** — read it. All of it.
**Step 2:** Go to **#rules** — read the standard.
**Step 3:** Go to **#orientation-map** — understand the system.
**Step 4:** Go to **#start-here** — understand what's expected of you.
**Step 5:** Go to **#verification** — click the green **VERIFY** button.

That's it. 5 steps. Under 10 minutes.

The only thing standing between you and access is whether you actually do it.`;

// ─── INACTIVITY DM MESSAGES ───────────────────────────────────────────────────

const INACTIVITY_WARNING_1 = `Just so you know — we don't keep idlers in The Vault of N.

You're verified. That's step one. But verified doesn't mean safe.

This server runs a fortnightly kick wave every Sunday. If you haven't sent a single message in any channel, you're gone. No exceptions. No appeals.

It's not personal. It's the standard.

Show up or step out.`;

const INACTIVITY_WARNING_2 = `This is your last warning.

You've been inactive for 11 days. Zero messages. Zero proof you're actually here.

Sunday is the kick wave. You will be removed if nothing changes before then.

This isn't a threat — it's a fact. The Vault of N doesn't carry dead weight. You either show up or you get cut. That's the deal you agreed to when you verified.

Go post something. Log something. Say something. Anything.

Or don't — and accept that you chose to leave.`;

const INACTIVITY_KICK_DM = `You were removed from The Vault of N.

You verified. You got access. And then you disappeared.

14 days. Zero messages. You had two warnings. You chose to ignore both of them.

That's not bad luck. That's a pattern. And this server exists specifically to break that pattern — but only for people who actually want to break it.

If you ever come back ready to actually show up, you know where to find us.

The standard doesn't lower. You rise to it or you don't.`;

// ─── TRACK MESSAGES FROM VERIFIED MEMBERS ────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Track last message time for verified members in guild
  if (message.guild) {
    const member = message.guild.members.cache.get(message.author.id);
    if (member && member.roles.cache.has(VERIFIED_ROLE_ID)) {
      lastMessageTime.set(message.author.id, Date.now());
    }
  }

  // Handle DM replies for verification help
  if (!message.guild) {
    const content = message.content.toLowerCase();
    if (
      content.includes("how") &&
      (content.includes("verify") || content.includes("verification"))
    ) {
      await message.reply(HOW_TO_VERIFY);
    } else if (
      content.includes("verify") ||
      content.includes("help") ||
      content.includes("what do i do") ||
      content.includes("steps")
    ) {
      await message.reply(HOW_TO_VERIFY);
    }
  }
});

// ─── HANDLE NEW MEMBERS ──────────────────────────────────────────────────────
client.on("guildMemberAdd", (member) => {
  if (member.user.bot) return;

  console.log(`[VERIFY] New member joined: ${member.user.tag}`);

  const firstTimer = setTimeout(async () => {
    const freshMember = await member.guild.members.fetch(member.id).catch(() => null);
    if (!freshMember || freshMember.roles.cache.has(VERIFIED_ROLE_ID)) {
      console.log(`[VERIFY] ${member.user.tag} already verified — skipping DM`);
      return;
    }

    try {
      await member.send(FIRST_DM);
      console.log(`[VERIFY] Sent first DM to ${member.user.tag}`);
    } catch (err) {
      console.log(`[VERIFY] Can't DM ${member.user.tag} — DMs disabled`);
    }

    reminderCounts.set(member.id, 0);
    startReminderLoop(member);
  }, FIRST_DM_DELAY);

  pendingTimers.set(member.id, [firstTimer]);
});

// ─── REMINDER LOOP (UNVERIFIED) ───────────────────────────────────────────────
function startReminderLoop(member) {
  const interval = setInterval(async () => {
    const freshMember = await member.guild.members.fetch(member.id).catch(() => null);

    if (!freshMember || freshMember.roles.cache.has(VERIFIED_ROLE_ID)) {
      console.log(`[VERIFY] ${member.user.tag} verified or left — stopping reminders`);
      clearInterval(interval);
      reminderCounts.delete(member.id);
      return;
    }

    const count = reminderCounts.get(member.id) || 0;
    const messageIndex = Math.min(count, REMINDER_DMS.length - 1);

    try {
      await member.send(REMINDER_DMS[messageIndex]);
      console.log(`[VERIFY] Sent reminder #${count + 1} to ${member.user.tag}`);
    } catch (err) {
      console.log(`[VERIFY] Can't DM ${member.user.tag} — DMs disabled`);
    }

    reminderCounts.set(member.id, count + 1);
  }, REMINDER_INTERVAL);

  const timers = pendingTimers.get(member.id) || [];
  timers.push(interval);
  pendingTimers.set(member.id, timers);
}

// ─── STOP REMINDERS WHEN THEY VERIFY ─────────────────────────────────────────
client.on("guildMemberUpdate", (oldMember, newMember) => {
  if (!oldMember.roles.cache.has(VERIFIED_ROLE_ID) && newMember.roles.cache.has(VERIFIED_ROLE_ID)) {
    console.log(`[VERIFY] ${newMember.user.tag} just verified — clearing timers`);
    const timers = pendingTimers.get(newMember.id);
    if (timers) {
      timers.forEach((t) => {
        clearTimeout(t);
        clearInterval(t);
      });
      pendingTimers.delete(newMember.id);
    }
    reminderCounts.delete(newMember.id);
    // Start tracking their activity from verification
    lastMessageTime.set(newMember.id, Date.now());
  }
});

// ─── FORTNIGHTLY KICK WAVE (UNVERIFIED) ──────────────────────────────────────
async function kickWave() {
  console.log("[VERIFY] ⚔️ UNVERIFIED KICK WAVE STARTING...");

  const guilds = client.guilds.cache;
  let totalKicked = 0;
  const kickedUsers = [];

  for (const [, guild] of guilds) {
    const members = await guild.members.fetch();

    for (const [, member] of members) {
      if (member.user.bot) continue;
      if (member.roles.cache.has(VERIFIED_ROLE_ID)) continue;

      const joinedAt = member.joinedAt;
      const daysSinceJoin = (Date.now() - joinedAt) / (1000 * 60 * 60 * 24);

      if (daysSinceJoin >= KICK_THRESHOLD_DAYS) {
        try { await member.send(KICK_DM); } catch (err) {}

        try {
          await member.kick("Unverified after 7+ days");
          kickedUsers.push(`${member.user.tag} — ${daysSinceJoin.toFixed(0)} days unverified`);
          totalKicked++;
        } catch (err) {
          console.log(`[VERIFY] Failed to kick ${member.user.tag}:`, err.message);
        }

        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  console.log(`[VERIFY] ⚔️ UNVERIFIED KICK WAVE COMPLETE — ${totalKicked} removed`);
  return { totalKicked, kickedUsers };
}

// ─── FORTNIGHTLY KICK WAVE (INACTIVE VERIFIED) ────────────────────────────────
async function inactivityKickWave() {
  console.log("[VERIFY] 💀 INACTIVITY KICK WAVE STARTING...");

  const guilds = client.guilds.cache;
  let totalKicked = 0;
  const kickedUsers = [];

  for (const [, guild] of guilds) {
    const members = await guild.members.fetch();

    for (const [, member] of members) {
      if (member.user.bot) continue;
      if (!member.roles.cache.has(VERIFIED_ROLE_ID)) continue;

      const lastMsg = lastMessageTime.get(member.id);
      const joinedAt = member.joinedAt;

      // Use last message time or join time, whichever is more recent
      const lastActivity = lastMsg || joinedAt.getTime();
      const daysSinceActivity = (Date.now() - lastActivity) / (1000 * 60 * 60 * 24);

      if (daysSinceActivity >= INACTIVITY_KICK_DAYS) {
        try { await member.send(INACTIVITY_KICK_DM); } catch (err) {}

        try {
          await member.kick("Inactive verified member — 14+ days no messages");
          kickedUsers.push(`${member.user.tag} — ${daysSinceActivity.toFixed(0)} days inactive`);
          totalKicked++;
          lastMessageTime.delete(member.id);
        } catch (err) {
          console.log(`[VERIFY] Failed to kick ${member.user.tag}:`, err.message);
        }

        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  console.log(`[VERIFY] 💀 INACTIVITY KICK WAVE COMPLETE — ${totalKicked} removed`);
  return { totalKicked, kickedUsers };
}

// ─── INACTIVITY WARNING CHECKER (RUNS DAILY) ─────────────────────────────────
async function checkInactivityWarnings() {
  console.log("[VERIFY] 🔍 Checking inactivity warnings...");

  const guilds = client.guilds.cache;

  for (const [, guild] of guilds) {
    const members = await guild.members.fetch();

    for (const [, member] of members) {
      if (member.user.bot) continue;
      if (!member.roles.cache.has(VERIFIED_ROLE_ID)) continue;

      const lastMsg = lastMessageTime.get(member.id);
      const joinedAt = member.joinedAt;
      const lastActivity = lastMsg || joinedAt.getTime();
      const daysSinceActivity = (Date.now() - lastActivity) / (1000 * 60 * 60 * 24);

      // Day 4 warning
      if (daysSinceActivity >= INACTIVITY_WARNING_1_DAYS && daysSinceActivity < INACTIVITY_WARNING_1_DAYS + 1) {
        try {
          await member.send(INACTIVITY_WARNING_1);
          console.log(`[VERIFY] Sent inactivity warning 1 to ${member.user.tag}`);
        } catch (err) {
          console.log(`[VERIFY] Can't DM ${member.user.tag}`);
        }
      }

      // Day 11 warning
      if (daysSinceActivity >= INACTIVITY_WARNING_2_DAYS && daysSinceActivity < INACTIVITY_WARNING_2_DAYS + 1) {
        try {
          await member.send(INACTIVITY_WARNING_2);
          console.log(`[VERIFY] Sent inactivity warning 2 to ${member.user.tag}`);
        } catch (err) {
          console.log(`[VERIFY] Can't DM ${member.user.tag}`);
        }
      }
    }
  }
}

// ─── COMBINED SUNDAY WAVE ─────────────────────────────────────────────────────
async function sundayWave() {
  const unverifiedResult = await kickWave();
  await new Promise((r) => setTimeout(r, 5000));
  const inactiveResult = await inactivityKickWave();

  // Send combined report to owner
  try {
    const owner = await client.users.fetch(OWNER_ID);

    const totalKicked = unverifiedResult.totalKicked + inactiveResult.totalKicked;

    if (totalKicked > 0) {
      let description = "";

      if (unverifiedResult.kickedUsers.length > 0) {
        description += `**Unverified (${unverifiedResult.totalKicked}):**\n`;
        description += unverifiedResult.kickedUsers.map((u, i) => `${i + 1}. ${u}`).join("\n");
        description += "\n\n";
      }

      if (inactiveResult.kickedUsers.length > 0) {
        description += `**Inactive Verified (${inactiveResult.totalKicked}):**\n`;
        description += inactiveResult.kickedUsers.map((u, i) => `${i + 1}. ${u}`).join("\n");
      }

      const report = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("⚔️ SUNDAY KICK WAVE REPORT")
        .setDescription(`**${totalKicked} total removed.**\n\n${description}`)
        .setFooter({ text: "The Vault of N — The Standard" })
        .setTimestamp();

      await owner.send({ embeds: [report] });
    } else {
      await owner.send("⚔️ **Sunday Kick Wave Complete** — No members removed this week. Clean house.");
    }
  } catch (err) {
    console.log("[VERIFY] Couldn't DM owner:", err.message);
  }
}

// ─── SCHEDULER ───────────────────────────────────────────────────────────────
function scheduleKickWave() {
  const now = new Date();
  const next = new Date();
  next.setHours(KICK_HOUR, 0, 0, 0);

  const daysUntilSunday = (KICK_DAY - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + (daysUntilSunday === 0 && now >= next ? 7 : daysUntilSunday));

  const msUntilKick = next - now;
  console.log(`[VERIFY] Next kick wave in ${Math.round(msUntilKick / 1000 / 60 / 60)} hours`);

  setTimeout(() => {
    sundayWave();
    setInterval(sundayWave, 14 * 24 * 60 * 60 * 1000); // Fortnightly
  }, msUntilKick);

  // Daily inactivity warning check at 10AM
  const nextCheck = new Date();
  nextCheck.setHours(10, 0, 0, 0);
  if (now >= nextCheck) nextCheck.setDate(nextCheck.getDate() + 1);
  const msUntilCheck = nextCheck - now;

  setTimeout(() => {
    checkInactivityWarnings();
    setInterval(checkInactivityWarnings, 24 * 60 * 60 * 1000);
  }, msUntilCheck);
}

// ─── BOT READY ───────────────────────────────────────────────────────────────
client.once("ready", () => {
  console.log(`[Bot] The Standard online as ${client.user.tag}`);
  scheduleKickWave();
});

client.login(DISCORD_TOKEN);
