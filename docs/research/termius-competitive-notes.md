# Termius competitive notes

**Date:** 2026-10-29
**Purpose:** Understand what real users praise and complain about in Termius (the leading cross-platform SSH client) to inform planning for our local-first, open-source macOS SSH client. This is a research summary of public opinion, not a product spec.

**Sources:** All findings come from public web sources only: G2 reviews (read via the Findstack mirror), Capterra, Trustpilot, Apple App Store listings, Reddit threads (r/sysadmin, r/devops, r/selfhosted, r/homelab, r/foss), Hacker News threads, GitHub repositories and the `termius-alternative` topic, LowEndTalk forums, and public blogs/YouTube reviews. No private data, no vendor contact, nothing verified with Termius itself. Recurring themes are weighted above one-off rants; thin evidence is flagged as such. Review-site populations skew vocal and older; treat frequency signals as directional, not statistical.

**Caveats:** Direct fetches of reddit.com, trustpilot.com and lobste.rs were blocked (bot protection), so some Reddit/Trustpilot quotes come from search-result snippets; links are given so each can be re-checked. G2 content was read through Findstack's mirror. Lobsters had no dedicated Termius thread that I could find. TrustRadius has no meaningful Termius SSH client page (its "Terminus" results are an unrelated ABM platform). App Store review text is sampled from search results, not a full scrape.

---

## Praise themes

### 1. Cross-device sync and ubiquity ("same host list everywhere")
The single most praised capability: one host list, vault, and key set that follows the user from desktop to phone to tablet. For mobile-heavy users this is the reason to stay.
- "I've been using Termius for a few years now. Absolutely essential to my job... syncing between my two Macs, as well as my iPhone and iPad, is exceptional." — macOS App Store review. https://apps.apple.com/us/app/termius-ssh-client-terminal/id1176074088
- "I love Termius because it helps me keep all my ssh keys synced." — r/homelab. https://www.reddit.com/r/homelab/comments/10ocg4s/
- Even competitors concede it: "Mobile SSH access and cross-device credential sync are Termius's genuine strengths. If either is a daily requirement... keep Termius." — ctrlops.io round-up. https://ctrlops.io/blog/termius-alternatives
- Frequency/confidence: **High.** Appears in app-store reviews, Reddit, HN, and every comparison article; it is Termius's core identity.

### 2. Polished UI, one-click connect, snippets and SFTP
Users consistently describe Termius as the "nice" SSH client: clean modern UI, saved hosts with grouping/tags/search, one-click connect, built-in SFTP, snippets, and port forwarding in one place — a big upgrade from PuTTY juggling.
- "Easily transfer and receive files between my laptop and phone. Great design, simple for creation of common connections. Dig a little deeper and all the advanced features are there." — App Store review (via Termius site). https://termius.com/index.html
- "I was using PuTTY for close to 15 years... when I started to have close to 100 servers it became a problem with finding the correct server. Termius fixed that issue with grouping, search and tags." — Capterra-style review on the pricing page. https://termius.com/pricing
- "I just love how easy it is to manage keys, profiles, connections and the ability to split screen sftp in Termius." — r/selfhosted. https://www.reddit.com/r/selfhosted/comments/1jjwl8c/
- Frequency/confidence: **High.** The dominant praise in G2 (40+ reviews read: "intuitive UI", "connect with a single click", snippets, SFTP) and app stores (4.6–4.9 stars across stores).

### 3. Mobile/iPad terminal experience is best-in-class
For emergencies from a phone or iPad, Termius is repeatedly called the default answer; Mosh support (free tier) removes the "session dies on phone sleep" pain.
- "I've used Termius on the iPad twice when my laptop wasn't available (both emergencies). I haven't found the need to look elsewhere for an iOS SSH client." — HN, Launch HN thread. https://news.ycombinator.com/item?id=20118727
- "Best free app for Mosh & SSH" — App Store review category. https://apps.apple.com/us/app/termius-modern-ssh-client/id549039908
- "I tried every possible app and always came back to Termius." — r/homelab iOS thread. https://www.reddit.com/r/homelab/comments/1nob2vg/
- Frequency/confidence: **Medium-high.** Strong in iOS-specific threads; a minority counter-current exists ("kinda feels dated", r/homelab) but is smaller.

---

## Complaint themes

### 1. Subscription pricing / no perpetual license (the loudest, most consistent complaint)
Users like the product but resent paying a recurring subscription for a terminal, especially individuals and homelabbers. Sync, vault, and snippets sit behind Pro (~$9.99–$10/month billed annually at last check; no one-time or lifetime option), which converts the most-praised feature (sync) into the main paywall.
- "The subscription model and the pricing are extortionate." — HN comment. https://news.ycombinator.com/item?id=42527355
- "Great tool but you will never convince me that a terminal is worth a subscription." — App Store review. https://apps.apple.com/us/app/termius-modern-ssh-client/id549039908
- "If Termius wasn't so expensive (8.30/month to manage my hobby servers), I would gladly pay for the sync." — LowEndTalk. https://lowendtalk.com/discussion/180287/
- "The price is a bit high compared to its alternatives." — Capterra. https://www.capterra.com/p/234457/Termius/reviews
- Frequency/confidence: **Very high.** The most repeated theme on every platform, since ~2019 (HN 2019 thread) to 2026 threads. Trustpilot overall sits at 2.4/5 largely on price/support complaints. https://www.trustpilot.com/review/termius.com

### 2. Data trust: account required, keys synced to vendor cloud, weak local protections
Power users object to Termius's architecture: an account is required, credentials sync through Termius's cloud, and there have been specific security complaints (plain-text key passphrases historically, no app lock on Windows). Export/lock-in fears amplify this.
- "Termius has horrible security practices or am I overreacting? ... The Windows app does not lock after you close it or reboot your device. It won't ask for password, PIN or Yubikey to open the app." — r/sysadmin (also r/devops). https://www.reddit.com/r/sysadmin/comments/1fmnynb/
- "You need to first completely disconnect the app from 'calling home'..." — r/selfhosted, "Termius and their dark ways". https://www.reddit.com/r/selfhosted/comments/135iugx/
- HN 2019: a founder confirmed SSH key passwords were stored in plain text ("that is user's home directory, e.g. SSH keys in ~/.ssh are also plain text"). https://news.ycombinator.com/item?id=20118727
- "Termius's own 'Export' pushes your public key to a server. It is not a way to get your data out as files. There is no official path for moving your hosts and keys to another client." — README of the third-party `termius-export` tool, which exists because export is a gap. https://github.com/y01and3/termius-export
- Frequency/confidence: **Medium-high.** Recurs in r/sysadmin/r/selfhosted/r/homelab and drives much of the self-hosted-alternative scene. Some claims are old (2019); the no-Windows-app-lock and no-official-export complaints are recent (2023–2026).

### 3. Reliability and performance bugs: crashes, slow SFTP, lost state
Concrete quality complaints: app crashes, sluggish host autocomplete, SFTP that is slow and freezes on bulk operations, update popups stealing keyboard focus, and data loss after updates (settings wiped on Linux update reports).
- "Downloading, uploading & even deleting files takes ages. The software even freezes when trying to delete more than 1000 files." — Trustpilot. https://www.trustpilot.com/review/termius.com
- "New hosts don't save, configs and keys disappear" after years of use — r/selfhosted, "Looking for a self-hosted/paid alternative to Termius". https://www.reddit.com/r/selfhosted/comments/1o3uqdd/
- "Update popup takes priority over keyboard input and I can't press enter to connect... (Who designed this???)" — Trustpilot. https://www.trustpilot.com/review/termius.com
- "Sometime the app get crashed"; "autocomplete" slowness also recurring in G2 reviews (read via Findstack mirror). https://findstack.com/products/termius/reviews
- Frequency/confidence: **Medium.** Multiple independent platforms repeat SFTP slowness and crashes; exact bugs vary by version. Termius's own changelogs repeatedly list "stability improvements" and an Electron update, consistent with this theme. https://apps.apple.com/us/app/termius-modern-ssh-client/id1176074088

### 4. Electron bloat / desktop resource use
Desktop builds are Electron-based; on HN and in alternatives' marketing, memory footprint and "not a real native app" come up repeatedly.
- HN 2019 thread repeatedly raised size/memory; a Rust alternative's README measures "one connected tab takes 76 MB where Tabby takes 580 MB", with Termius grouped in the same "fat client" camp. https://github.com/your-moon/tern
- "Tern does what Termius and Tabby do... but as one small native process." — same README; the framing itself shows the complaint Termius leaves open. https://github.com/your-moon/tern
- Frequency/confidence: **Low-medium** as an explicit user quote, but it is a structural theme in every "Termius alternative" comparison (weight is inferred from how alternatives position against it). Our native Tauri/Rust shell directly answers this.

### 5. Platform and product gaps
Recurring "I'd pay if it just had X" items: theming/color limits (some terminal output "invisible or ugly"), no true offline/local mode, no one-time purchase, no Linux-first parity complaints in threads where alternatives lack Linux too, sessions not surviving phone-lock on iOS historically, and hierarchy (hosts/users/groups) confusion.
- "Limited theming which makes some terminal output invisible or ugly colors. The hierarchy with hosts/users is a bit confusing." — App Store review (via search). https://apps.apple.com/bg/app/549039908?see-all=reviews&platform=iphone
- "You can't quick connect with username@host, it'll prompt for a username anyway." — Trustpilot. https://www.trustpilot.com/review/termius.com
- Support friction: G2 reviews include a two-month wait for an MFA reset on a locked account (support complaint tied to the account-required model). https://findstack.com/products/termius/reviews
- Frequency/confidence: **Medium.** Theming and quick-connect are specific and repeated; the support complaint is one strong review, flagged as thinner evidence.

---

## Feature requests and gaps users are trying to fill

- **Self-hosted sync / own-vault:** the entire Termix/"self-hosted Termius alternative" wave (GitHub topic `termius-alternative` has many active repos, e.g. Rust/Tauri local-first clients with E2EE sync and self-hosted vaults) exists to answer "my SSH keys in somebody else's cloud." https://github.com/topics/termius-alternative , https://www.virtualizationhowto.com/2026/05/i-did-not-expect-to-like-this-self-hosted-termius-alternative-this-much
- **Local-first, offline, no account:** repeated asks in r/selfhosted/r/sysadmin threads and HN comments ("synced... p2p so they all maintain the same list", HN 42527355).
- **One-time purchase:** "no subscription" is the headline of competing apps' pitches (e.g. Show HN: Termix, "no subscription"). https://news.ycombinator.com/item?id=43331779
- **Data export / open formats:** demand evidenced by third-party decrypt-and-export tools (termius-export, termius-local-export) translating Termius data into OpenSSH/Tabby/Termix formats. https://github.com/y01and3/termius-export
- **Native, low-resource desktop app:** Rust/GPUI and Tauri alternatives (tern, purple, etc.) compete explicitly on memory. https://github.com/topics/termius-alternative
- **AI-agent-aware workflows:** Termius is now shipping "AI agent starts automatically when you connect" and voice input in its own changelog — the vendor is moving here, so this is table stakes soon rather than a gap. https://apps.apple.com/us/app/termius-modern-ssh-client/id549039908

---

## Implications for our local-first macOS client

**Copy (proven demands):**
- A structured host manager — groups, tags, search, one-click connect — is the reason people tolerate Termius's price. Any serious client needs it from day one.
- Snippets and built-in SFTP (preferably fast, with bulk operations that don't freeze) are frequently named delights; SFTP speed is also a named Termius weakness we can win on.
- Mobile-class session resilience (Mosh-style keep-alive behavior, background reconnect) is what mobile users love; when we ever ship mobile, this is the bar.

**Avoid (named pain):**
- Do not put core value behind an account or a subscription. Free tier must include the thing users actually want (for Termius that was sync); a local-first default with optional user-controlled sync is the exact inversion of the complaint.
- Do not sync private keys to a vendor cloud by default; keep credentials local (macOS Keychain) and make any sync end-to-end encrypted and user-hosted or bring-your-own-storage. Never require an account to use the app.
- Ship a real export (OpenSSH config, JSON) and import from day one — lock-in is a top complaint and cheap to avoid.
- Stay native and light (Tauri/Rust): "Electron bloat" is a recurring criticism of Termius-class apps.
- Invest in theming/fonts and correct key handling early; both are small things users complain about loudly.
- Don't gate basic local usability on connectivity; "works fully offline with no phoning home" directly answers the r/selfhosted "dark ways" thread.

**Positioning reality check:** Termius is genuinely loved for polish and mobile ubiquity (4.6–4.9 stars in app stores) while being disliked on Trustpilot (2.4/5) for price and support — a polarized, vulnerable incumbent. The market has already validated demand for alternatives: the `termius-alternative` GitHub topic is crowded and active, and self-hosted alternatives (Termix et al.) are getting glowing independent reviews. Our wedge is narrower and defensible: a native, local-first, open-source, macOS-first client that never holds your keys and never asks for a subscription, with a clean export path.
