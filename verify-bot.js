const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN_VERIFY;
const VERIFIED_ROLE_ID = "1443889532956053525";
const OWNER_ID = "1348246749596094474";
const KICK_DAY = 0; // Sunday (0=Sun, 1=Mon, etc.)
const KICK_HOUR = 9;
const FIRST_DM_DELAY = 30 * 1000; // 30 seconds
const REMINDER_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const KICK_THRESHOLD_DAYS = 7;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Track reminder counts per user
const reminderCounts = new Map();
// Track pending timeouts so we can cancel if they verify
const pendingTimers = new Map();

// ─── DM MESSAGES ──────────────────────────────────────────────────────────────

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
  // Day 1 reminder (24hrs)
  `Still not verified.

You've been in the server for over a day now and you haven't done the one thing that was asked of you — verify.

You know what that tells me? You're the same person in here that you are out there. Someone who knows what to do but doesn't do it.

Go to **#verification**. Click the button. Or don't — but understand that we remove people who don't show up.`,

  // Day 2 reminder (48hrs)
  `Day 2. Still nothing.

I'm not going to sugarcoat this. You joined a community built on execution and you've executed nothing. Not even a button click.

If you need the steps again, type **"how do I verify"** and I'll send them.

Otherwise — go to **#verification** and handle it. The kick wave runs every Sunday. The clock is ticking.`,

  // Day 3 reminder (72hrs)
  `3 days. No verification. No action. No proof you belong here.

This is your last friendly reminder. After this I stop asking nicely.

**#verification** → click VERIFY. That's all it takes.

If you can't commit to clicking one button, how are you going to commit to changing your life?`,

  // Day 4+ reminders
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

// ─── HANDLE NEW MEMBERS ──────────────────────────────────────────────────────
client.on("guildMemberAdd", (member) => {
  if (member.user.bot) return;

  console.log(`[VERIFY] New member joined: ${member.user.tag}`);

  // First DM after 10 minutes
  const firstTimer = setTimeout(async () => {
    // Check if they verified in the 10 minutes
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

    // Start 24hr reminder loop
    reminderCounts.set(member.id, 0);
    startReminderLoop(member);
  }, FIRST_DM_DELAY);

  pendingTimers.set(member.id, [firstTimer]);
});

// ─── REMINDER LOOP ───────────────────────────────────────────────────────────
function startReminderLoop(member) {
  const interval = setInterval(async () => {
    // Re-fetch member to check if they verified
    const freshMember = await member.guild.members.fetch(member.id).catch(() => null);

    // If they left or verified, stop reminders
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

  // Store interval so we can clear it
  const timers = pendingTimers.get(member.id) || [];
  timers.push(interval);
  pendingTimers.set(member.id, timers);
}

// ─── STOP REMINDERS WHEN THEY VERIFY ─────────────────────────────────────────
client.on("guildMemberUpdate", (oldMember, newMember) => {
  // Check if they just got the verified role
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
  }
});

// ─── HANDLE DM REPLIES ───────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) {
    // This is a DM
    const content = message.content.toLowerCase();
    if (
      content.includes("how") &&
      (content.includes("verify") || content.includes("verification"))
    ) {
      await message.reply(HOW_TO_VERIFY);
      console.log(`[VERIFY] Sent how-to-verify to ${message.author.tag}`);
    } else if (
      content.includes("verify") ||
      content.includes("help") ||
      content.includes("what do i do") ||
      content.includes("steps")
    ) {
      await message.reply(HOW_TO_VERIFY);
      console.log(`[VERIFY] Sent how-to-verify to ${message.author.tag}`);
    }
  }
});

// ─── WEEKLY KICK WAVE (SUNDAY 9AM) ───────────────────────────────────────────
async function kickWave() {
  console.log("[VERIFY] ⚔️ KICK WAVE STARTING...");

  const guilds = client.guilds.cache;
  let totalKicked = 0;
  const kickedUsers = [];

  for (const [, guild] of guilds) {
    const members = await guild.members.fetch();

    for (const [, member] of members) {
      if (member.user.bot) continue;
      if (member.roles.cache.has(VERIFIED_ROLE_ID)) continue;

      // Check if they've been in the server for 7+ days
      const joinedAt = member.joinedAt;
      const daysSinceJoin = (Date.now() - joinedAt) / (1000 * 60 * 60 * 24);

      if (daysSinceJoin >= KICK_THRESHOLD_DAYS) {
        // Send final DM
        try {
          await member.send(KICK_DM);
        } catch (err) {
          console.log(`[VERIFY] Can't DM ${member.user.tag} before kick`);
        }

        // Kick
        try {
          await member.kick("Unverified after 7+ days");
          console.log(`[VERIFY] Kicked: ${member.user.tag} (${daysSinceJoin.toFixed(1)} days)`);
          kickedUsers.push(`${member.user.tag} — ${daysSinceJoin.toFixed(0)} days unverified`);
          totalKicked++;
        } catch (err) {
          console.log(`[VERIFY] Failed to kick ${member.user.tag}:`, err.message);
        }

        // Small delay between kicks
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  // DM the owner with the report
  try {
    const owner = await client.users.fetch(OWNER_ID);
    if (kickedUsers.length > 0) {
      const report = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("⚔️ WEEKLY KICK WAVE REPORT")
        .setDescription(
          `**${totalKicked} member${totalKicked === 1 ? "" : "s"} removed.**\n\n` +
            kickedUsers.map((u, i) => `${i + 1}. ${u}`).join("\n")
        )
        .setFooter({ text: `The Forge — Sunday Kick Wave` })
        .setTimestamp();

      await owner.send({ embeds: [report] });
    } else {
      await owner.send("⚔️ **Kick Wave Complete** — No unverified members to remove this week. Clean house.");
    }
  } catch (err) {
    console.log("[VERIFY] Couldn't DM owner:", err.message);
  }

  console.log(`[VERIFY] ⚔️ KICK WAVE COMPLETE — ${totalKicked} removed`);
}

// ─── SCHEDULER ───────────────────────────────────────────────────────────────
function scheduleKickWave() {
  const now = new Date();
  const next = new Date();
  next.setHours(KICK_HOUR, 0, 0, 0);

  // Find next Sunday
  const daysUntilSunday = (KICK_DAY - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + (daysUntilSunday === 0 && now >= next ? 7 : daysUntilSunday));

  const msUntilKick = next - now;
  console.log(`[VERIFY] Next kick wave in ${Math.round(msUntilKick / 1000 / 60 / 60)} hours`);

  setTimeout(() => {
    kickWave();
    // Repeat every 7 days
    setInterval(kickWave, 7 * 24 * 60 * 60 * 1000);
  }, msUntilKick);
}

// ─── BOT READY ───────────────────────────────────────────────────────────────
client.once("ready", () => {
  console.log(`[Bot] Verification bot online as ${client.user.tag}`);
  scheduleKickWave();
});

client.login(DISCORD_TOKEN);
