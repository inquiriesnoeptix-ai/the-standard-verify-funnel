const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const DISCORD_TOKEN = process.env.DISCORD_TOKEN_VERIFY;
const VERIFIED_ROLE_ID = "1443889532956053525";
const OWNER_ID = "1348246749596094474";
const KICK_DAY = 0; // Sunday
const KICK_HOUR = 9;
const FIRST_DM_DELAY = 10 * 60 * 1000; // 10 min after joining
const REMINDER_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
const KICK_THRESHOLD_DAYS = 7; // Unverified kicked after 7 days

// Inactivity thresholds (change these to small numbers for testing)
const INACTIVITY_WARNING_1_DAYS = 4; // First warning at 4 days 
const INACTIVITY_WARNING_2_DAYS = 11;
const INACTIVITY_KICK_DAYS = 14;

// How often to check inactivity (every 6 hours in production)
const INACTIVITY_CHECK_INTERVAL = 6 * 60 * 60 * 1000;

// ─── CLIENT ──────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ],
});

// Storage
const lastMessageTime = new Map(); // userId → timestamp
const reminderCounts = new Map();  // userId → count
const pendingTimers = new Map();   // userId → [timers]
const warningSent = new Map();     // userId → { w1: bool, w2: bool }

// ─── MESSAGES: UNVERIFIED ────────────────────────────────────────────────────

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

You've been in the server for over a day now and you haven't done the one thing asked of you — verify.

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

Sunday the kick wave runs. Unverified members are removed. No exceptions. No second chances.

This is not a threat. It's the standard. Either meet it or accept that you weren't ready.

**#verification** → VERIFY. Last chance.`,
];

const UNVERIFIED_KICK_DM = `You were removed from The Vault of N.

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

// ─── MESSAGES: INACTIVITY ────────────────────────────────────────────────────

const INACTIVITY_WARNING_1 = `Just so you know — we don't keep idlers in The Vault of N.

You're verified. That's step one. But verified doesn't mean safe.

This server runs a fortnightly kick wave every Sunday. If you haven't sent a single message in any channel, you're gone. No exceptions. No appeals.

It's not personal. It's the standard.

Show up or step out.`;

const INACTIVITY_WARNING_2 = `This is your last warning.

You've been inactive for too long. Zero messages. Zero proof you're actually here.

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

// ─── TRACK MESSAGES ──────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  // Track verified members' last message time
  if (message.guild) {
    const member = message.guild.members.cache.get(message.author.id);
    if (member && member.roles.cache.has(VERIFIED_ROLE_ID)) {
      lastMessageTime.set(message.author.id, Date.now());
      // Reset warning flags if they post again
      warningSent.set(message.author.id, { w1: false, w2: false });
    }
  }

  // Handle DM replies for verification help
  if (!message.guild) {
    const content = message.content.toLowerCase();
    if (
      content.includes("verify") ||
      content.includes("how") ||
      content.includes("help") ||
      content.includes("steps") ||
      content.includes("what do i do")
    ) {
      try { await message.reply(HOW_TO_VERIFY); } catch (err) {}
    }
  }
});

// ─── NEW MEMBER ──────────────────────────────────────────────────────────────
client.on("guildMemberAdd", (member) => {
  if (member.user.bot) return;
  console.log(`[VERIFY] New member: ${member.user.tag}`);

  const firstTimer = setTimeout(async () => {
    const freshMember = await member.guild.members.fetch(member.id).catch(() => null);
    if (!freshMember || freshMember.roles.cache.has(VERIFIED_ROLE_ID)) return;

    try {
      await member.send(FIRST_DM);
      console.log(`[VERIFY] First DM sent to ${member.user.tag}`);
    } catch (err) {
      console.log(`[VERIFY] Can't DM ${member.user.tag}`);
    }

    reminderCounts.set(member.id, 0);
    startReminderLoop(member);
  }, FIRST_DM_DELAY);

  pendingTimers.set(member.id, [firstTimer]);
});

// ─── UNVERIFIED REMINDER LOOP ─────────────────────────────────────────────────
function startReminderLoop(member) {
  const interval = setInterval(async () => {
    const freshMember = await member.guild.members.fetch(member.id).catch(() => null);

    if (!freshMember || freshMember.roles.cache.has(VERIFIED_ROLE_ID)) {
      clearInterval(interval);
      reminderCounts.delete(member.id);
      return;
    }

    const count = reminderCounts.get(member.id) || 0;
    const msgIndex = Math.min(count, REMINDER_DMS.length - 1);

    try {
      await member.send(REMINDER_DMS[msgIndex]);
      console.log(`[VERIFY] Reminder #${count + 1} → ${member.user.tag}`);
    } catch (err) {}

    reminderCounts.set(member.id, count + 1);
  }, REMINDER_INTERVAL);

  const timers = pendingTimers.get(member.id) || [];
  timers.push(interval);
  pendingTimers.set(member.id, timers);
}

// ─── VERIFIED — CLEAR TIMERS ─────────────────────────────────────────────────
client.on("guildMemberUpdate", (oldMember, newMember) => {
  const justVerified = !oldMember.roles.cache.has(VERIFIED_ROLE_ID) && newMember.roles.cache.has(VERIFIED_ROLE_ID);
  if (!justVerified) return;

  console.log(`[VERIFY] ${newMember.user.tag} verified — clearing timers`);

  const timers = pendingTimers.get(newMember.id);
  if (timers) {
    timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
    pendingTimers.delete(newMember.id);
  }
  reminderCounts.delete(newMember.id);

  // Start tracking from verification
  lastMessageTime.set(newMember.id, Date.now());
  warningSent.set(newMember.id, { w1: false, w2: false });
});

// ─── INACTIVITY CHECKER ──────────────────────────────────────────────────────
async function checkInactivityWarnings() {
  console.log("[VERIFY] 🔍 Checking inactivity...");

  for (const [, guild] of client.guilds.cache) {
    const members = await guild.members.fetch();

    for (const [, member] of members) {
      if (member.user.bot) continue;
      if (!member.roles.cache.has(VERIFIED_ROLE_ID)) continue;

      const lastMsg = lastMessageTime.get(member.id);
      const lastActivity = lastMsg || member.joinedAt.getTime();
      const daysSince = (Date.now() - lastActivity) / (1000 * 60 * 60 * 24);

      const warnings = warningSent.get(member.id) || { w1: false, w2: false };

      // Warning 1 — Day 4
      if (daysSince >= INACTIVITY_WARNING_1_DAYS && !warnings.w1) {
        try {
          await member.send(INACTIVITY_WARNING_1);
          console.log(`[VERIFY] Warning 1 → ${member.user.tag} (${daysSince.toFixed(1)} days inactive)`);
          warnings.w1 = true;
          warningSent.set(member.id, warnings);
        } catch (err) {}
      }

      // Warning 2 — Day 11
      if (daysSince >= INACTIVITY_WARNING_2_DAYS && !warnings.w2) {
        try {
          await member.send(INACTIVITY_WARNING_2);
          console.log(`[VERIFY] Warning 2 → ${member.user.tag} (${daysSince.toFixed(1)} days inactive)`);
          warnings.w2 = true;
          warningSent.set(member.id, warnings);
        } catch (err) {}
      }
    }
  }
}

// ─── SUNDAY KICK WAVE ─────────────────────────────────────────────────────────
async function sundayWave() {
  console.log("[VERIFY] ⚔️ SUNDAY WAVE STARTING...");

  const unverifiedKicked = [];
  const inactiveKicked = [];

  for (const [, guild] of client.guilds.cache) {
    const members = await guild.members.fetch();

    for (const [, member] of members) {
      if (member.user.bot) continue;

      const isVerified = member.roles.cache.has(VERIFIED_ROLE_ID);
      const daysSinceJoin = (Date.now() - member.joinedAt) / (1000 * 60 * 60 * 24);

      // Kick unverified after 7 days
      if (!isVerified && daysSinceJoin >= KICK_THRESHOLD_DAYS) {
        try { await member.send(UNVERIFIED_KICK_DM); } catch (err) {}
        try {
          await member.kick("Unverified after 7+ days");
          unverifiedKicked.push(`${member.user.tag} — ${daysSinceJoin.toFixed(0)} days`);
          console.log(`[VERIFY] Kicked unverified: ${member.user.tag}`);
        } catch (err) {}
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Kick inactive verified after 14 days
      if (isVerified) {
        const lastMsg = lastMessageTime.get(member.id);
        const lastActivity = lastMsg || member.joinedAt.getTime();
        const daysSinceActivity = (Date.now() - lastActivity) / (1000 * 60 * 60 * 24);

        if (daysSinceActivity >= INACTIVITY_KICK_DAYS) {
          try { await member.send(INACTIVITY_KICK_DM); } catch (err) {}
          try {
            await member.kick("Inactive 14+ days — no messages");
            inactiveKicked.push(`${member.user.tag} — ${daysSinceActivity.toFixed(0)} days inactive`);
            lastMessageTime.delete(member.id);
            warningSent.delete(member.id);
            console.log(`[VERIFY] Kicked inactive: ${member.user.tag}`);
          } catch (err) {}
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }
  }

  // Send report to owner
  try {
    const owner = await client.users.fetch(OWNER_ID);
    const total = unverifiedKicked.length + inactiveKicked.length;

    if (total > 0) {
      let desc = "";
      if (unverifiedKicked.length > 0) {
        desc += `**Unverified removed (${unverifiedKicked.length}):**\n`;
        desc += unverifiedKicked.map((u, i) => `${i + 1}. ${u}`).join("\n") + "\n\n";
      }
      if (inactiveKicked.length > 0) {
        desc += `**Inactive verified removed (${inactiveKicked.length}):**\n`;
        desc += inactiveKicked.map((u, i) => `${i + 1}. ${u}`).join("\n");
      }

      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("⚔️ SUNDAY KICK WAVE REPORT")
        .setDescription(`**${total} total removed.**\n\n${desc}`)
        .setFooter({ text: "The Vault of N — The Standard" })
        .setTimestamp();

      await owner.send({ embeds: [embed] });
    } else {
      await owner.send("⚔️ **Sunday Wave Complete** — No members removed. Clean house.");
    }
  } catch (err) {
    console.log("[VERIFY] Couldn't DM owner report");
  }

  console.log("[VERIFY] ⚔️ SUNDAY WAVE COMPLETE");
}

// ─── SCHEDULE ─────────────────────────────────────────────────────────────────
function schedule() {
  // Schedule Sunday 9AM kick wave
  const now = new Date();
  const next = new Date();
  next.setHours(KICK_HOUR, 0, 0, 0);
  const daysUntilSunday = (KICK_DAY - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + (daysUntilSunday === 0 && now >= next ? 7 : daysUntilSunday));

  const msUntilKick = next - now;
  console.log(`[VERIFY] Next kick wave in ${Math.round(msUntilKick / 1000 / 60 / 60)} hours`);

  setTimeout(() => {
    sundayWave();
    setInterval(sundayWave, 7 * 24 * 60 * 60 * 1000); // Weekly
  }, msUntilKick);

  // Run inactivity check every 6 hours starting now
  checkInactivityWarnings();
  setInterval(checkInactivityWarnings, INACTIVITY_CHECK_INTERVAL);
}

// ─── READY ────────────────────────────────────────────────────────────────────
client.once("clientReady", () => {
  console.log(`[Bot] The Standard online as ${client.user.tag}`);
  schedule();
});

client.login(DISCORD_TOKEN);
