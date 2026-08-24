// Discord gateway bot — runs inside the HQ app. Shows a Verify button/modal,
// emails a magic link (via discord-verify), and grants the role when the link
// is clicked (grantRole is called by the /api/discord/verify route).

const {
  Client, GatewayIntentBits, Partials,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { requestVerify } = require('./discord-verify');

const TOKEN    = process.env.DISCORD_BOT_TOKEN || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const ROLE_ID  = process.env.DISCORD_VERIFIED_ROLE_ID || '';

const client = new Client({ intents: [GatewayIntentBits.Guilds], partials: [Partials.Channel] });

function emailModal() {
  const input = new TextInputBuilder()
    .setCustomId('email').setLabel('อีเมลที่ใช้กับ StrikePro')
    .setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('you@example.com');
  return new ModalBuilder().setCustomId('sp_verify_modal').setTitle('ยืนยันลูกค้า StrikePro')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

function verifyPanel() {
  const embed = new EmbedBuilder()
    .setTitle('✅ ยืนยันตัวตนลูกค้า StrikePro')
    .setDescription('กดปุ่มด้านล่าง แล้วกรอกอีเมลที่ใช้กับ StrikePro\nเราจะส่ง**ลิงก์ยืนยัน**ไปที่อีเมลของคุณ — กดลิงก์เพื่อรับยศ')
    .setColor(0x5865F2);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('sp_verify').setLabel('ยืนยันอีเมล StrikePro').setStyle(ButtonStyle.Success).setEmoji('✅')
  );
  return { embeds: [embed], components: [row] };
}

client.once('ready', async () => {
  console.log(`  🤖 Discord bot online as ${client.user.tag}`);
  try {
    const cmds = [
      { name: 'verify', description: 'ยืนยันอีเมลว่าเป็นลูกค้า StrikePro เพื่อรับยศ' },
      { name: 'verify-panel', description: '(แอดมิน) โพสต์ปุ่มยืนยันในห้องนี้',
        default_member_permissions: String(PermissionFlagsBits.ManageGuild) },
    ];
    if (GUILD_ID) { const g = await client.guilds.fetch(GUILD_ID); await g.commands.set(cmds); }
    else { await client.application.commands.set(cmds); } // global (slower to propagate)
  } catch (e) { console.error('Discord command registration failed:', e.message); }
});

client.on('interactionCreate', async (interaction) => {
  try {
    // open the email modal (slash command or button)
    if ((interaction.isChatInputCommand() && interaction.commandName === 'verify') ||
        (interaction.isButton() && interaction.customId === 'sp_verify')) {
      return interaction.showModal(emailModal());
    }
    // admin: post the verify panel in the current channel
    if (interaction.isChatInputCommand() && interaction.commandName === 'verify-panel') {
      await interaction.channel.send(verifyPanel());
      return interaction.reply({ content: '✅ โพสต์ปุ่มยืนยันแล้ว', ephemeral: true });
    }
    // email submitted → check customer + send magic link
    if (interaction.isModalSubmit() && interaction.customId === 'sp_verify_modal') {
      const email = interaction.fields.getTextInputValue('email');
      await interaction.deferReply({ ephemeral: true });
      const r = await requestVerify({
        discordId: interaction.user.id, username: interaction.user.tag,
        email, guildId: interaction.guildId,
      });
      let msg;
      if (r.sent) msg = `📧 ส่งลิงก์ยืนยันไปที่ **${email}** แล้ว — เปิดอีเมลแล้วกดปุ่มเพื่อรับยศ (ลิงก์ใช้ได้ 30 นาที)`;
      else if (r.reason === 'not_customer') msg = '❌ ไม่พบอีเมลนี้ในระบบลูกค้า StrikePro — ตรวจว่าเป็นอีเมลเดียวกับที่ใช้สมัคร StrikePro';
      else if (r.reason === 'email_taken')  msg = '⚠️ อีเมลนี้ถูกใช้ยืนยันกับบัญชี Discord อื่นแล้ว';
      else if (r.reason === 'bad_input')    msg = '❌ อีเมลไม่ถูกต้อง';
      else msg = '⚠️ ระบบตรวจสอบมีปัญหาชั่วคราว กรุณาลองใหม่';
      return interaction.editReply({ content: msg });
    }
  } catch (e) {
    console.error('Discord interaction error:', e.message);
    try { if (interaction.isRepliable() && !interaction.replied) await interaction.reply({ content: '⚠️ เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', ephemeral: true }); } catch (_) {}
  }
});

// Grant the verified role — called by the magic-link route after token check.
async function grantRole(guildId, userId, roleId) {
  const guild  = await client.guilds.fetch(guildId || GUILD_ID);
  const member = await guild.members.fetch(userId);
  await member.roles.add(roleId || ROLE_ID);
  return { guild: guild.name, member: member.user.tag };
}

function start() {
  if (!TOKEN) { console.log('  🤖 Discord bot: DISCORD_BOT_TOKEN not set — bot disabled'); return; }
  client.login(TOKEN).catch(e => console.error('Discord login failed:', e.message));
}

module.exports = { start, grantRole, client };
