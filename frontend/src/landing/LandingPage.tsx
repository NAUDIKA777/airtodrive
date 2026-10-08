import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, type IconName } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { mono } from "@/src/fonts";
import { useBuy, useCheckoutConfig } from "@/src/landing/useCheckout";
import { setPromptDismissed, usePwaInstall, wasPromptDismissed } from "@/src/landing/usePwaInstall";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const MAX_W = 1120;

const FEATURES: { id: string; icon: IconName; title: string; body: string }[] = [
  {
    id: "feature-video",
    icon: "movie-open-outline",
    title: "Video Creators",
    body:
      "Capture up to twelve hours of footage in a single session and stream it straight to your drive — no more 'storage full' warnings mid-shoot.",
  },
  {
    id: "feature-pro",
    icon: "briefcase-download-outline",
    title: "Mobile Professionals",
    body:
      "Download large project archives on the move, ready for plug-and-play the moment you reach your desktop workstation.",
  },
  {
    id: "feature-astro",
    icon: "telescope",
    title: "Amateur Astronomers",
    body:
      "Log entire all-night raw telescope captures in the field, writing gigabytes directly to external storage without filling your phone.",
  },
];

const PRICE_BULLETS = [
  "Direct-to-USB stream downloading with zero internal storage used",
  "Unlimited large file transfers and background downloads",
  "Works directly with USB OTG drives and external storage",
  "Lifetime access with all future updates included",
  "Priority email support",
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Which USB drives are compatible?",
    a: "Any USB-OTG flash drive, USB-C stick or external SSD/HDD your Android device can mount. Air to Drive writes straight to it through Android's Storage Access Framework — format it as FAT32, exFAT or ext4 and you're ready to stream.",
  },
  {
    q: "Which phones are supported?",
    a: "Android phones and tablets with USB-OTG support (the vast majority made in the last several years) running Android 10 or newer. If your drive and phone use different ports, a simple USB-OTG adapter bridges the two.",
  },
  {
    q: "What's your refund policy?",
    a: "Lifetime Access is a one-time purchase. If it doesn't work smoothly with your device, email priority support within 14 days of buying and we'll refund you in full — no hassle.",
  },
];

const REGULAR_CENTS = 1995;
const SALE_CENTS = 1495;
const PROMO_CODES: Record<string, number> = { LAUNCH25: 25, EARLY50: 50, FOUNDER: 30 };

export function LandingPage() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  const { installed, promptInstall } = usePwaInstall();
  const cfg = useCheckoutConfig();
  const { busy, buy } = useBuy((msg) => toast.show(msg, "info"));

  const [showInstall, setShowInstall] = useState(false);
  const [promo, setPromo] = useState("");
  const [applied, setApplied] = useState<{ code: string; pct: number } | null>(null);
  // Mirror the server's integer-cent math exactly so the displayed price always
  // equals what Stripe charges (server is authoritative).
  const promoCents = Math.round(REGULAR_CENTS * (1 - (applied?.pct ?? 0) / 100));
  const currentCents = applied ? Math.min(promoCents, SALE_CENTS) : SALE_CENTS;
  const currentPrice = (currentCents / 100).toFixed(2);

  useEffect(() => {
    if (Platform.OS !== "web" || installed) return;
    let active = true;
    (async () => {
      const dismissed = await wasPromptDismissed();
      if (active && !dismissed) setTimeout(() => active && setShowInstall(true), 900);
    })();
    return () => {
      active = false;
    };
  }, [installed]);

  const doInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === "unavailable") {
      toast.show("Use your browser menu → 'Add to Home Screen' to install", "info");
    } else if (outcome === "accepted") {
      toast.show("Installing Air to Drive…", "success");
    }
    setShowInstall(false);
  };

  const dismissInstall = async () => {
    await setPromptDismissed();
    setShowInstall(false);
  };

  const applyPromo = () => {
    const code = promo.trim().toUpperCase();
    const pct = PROMO_CODES[code];
    if (pct) {
      setApplied({ code, pct });
      toast.show(`Promo ${code} applied — ${pct}% off`, "success");
    } else {
      toast.show("That promo code isn't valid", "error");
    }
  };

  const removePromo = () => {
    setApplied(null);
    setPromo("");
  };

  const InstallBtn = ({ testID, label }: { testID: string; label: string }) =>
    installed ? (
      <View style={[styles.btn, styles.btnGhost]} testID={testID}>
        <Icon name="check-bold" size={16} color={colors.brandSecondary} />
        <Text style={[styles.btnText, { color: colors.brandSecondary }]}>Installed</Text>
      </View>
    ) : (
      <Pressable testID={testID} onPress={doInstall} style={({ pressed }) => [styles.btn, styles.btnGhost, pressed && styles.pressed]}>
        <Icon name="download" size={16} color={colors.brandPrimary} />
        <Text style={[styles.btnText, { color: colors.brandPrimary }]}>{label}</Text>
      </Pressable>
    );

  const BuyBtn = ({ testID, label }: { testID: string; label: string }) => (
    <Pressable testID={testID} onPress={() => buy(applied?.code)} disabled={busy} style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && styles.pressed]}>
      <Icon name="lightning-bolt" size={16} color={colors.onBrandPrimary} />
      <Text style={[styles.btnText, { color: colors.onBrandPrimary }]}>{busy ? "Opening…" : label}</Text>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}>
        {/* NAV */}
        <View style={[styles.nav, { paddingTop: insets.top + spacing.md }]}>
          <View style={[styles.navInner, { maxWidth: MAX_W }]}>
            <View style={styles.brandRow}>
              <View style={styles.logoMark}>
                <Image source={require("@/assets/images/logo-mark.png")} style={styles.logoMarkImg} contentFit="contain" />
              </View>
              <Text style={styles.wordmark}>AIR TO DRIVE</Text>
            </View>
            <View style={styles.navBtns}>
              {wide ? <InstallBtn testID="nav-install" label="Install App" /> : null}
              <BuyBtn testID="nav-buy" label="Get Lifetime" />
            </View>
          </View>
        </View>

        {/* HERO */}
        <LinearGradient colors={["#0A1A20", "#0E0E0F"]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.heroBg}>
          <View style={[styles.sectionInner, { maxWidth: MAX_W }]}>
            <View style={[styles.heroWrap, wide && styles.heroWrapWide]}>
              <View style={[styles.heroText, wide && { flex: 1 }]}>
                <View style={styles.pill}>
                  <View style={styles.pillDot} />
                  <Text style={styles.pillText}>PROGRESSIVE WEB APP · USB OTG</Text>
                </View>
                <Text style={[styles.h1, wide && styles.h1Wide]}>
                  Massive Files Directly to External Drives,{" "}
                  <Text style={styles.h1Accent}>Zero Phone Storage Required</Text>
                </Text>
                <Text style={styles.sub}>
                  Download twelve-hour creator videos and massive work files on the go — with zero
                  device clutter. Air to Drive streams every byte straight to your USB drive, never
                  touching internal storage.
                </Text>
                <View style={[styles.heroBtns, !wide && { flexDirection: "column", alignItems: "stretch" }]}>
                  <BuyBtn testID="hero-buy" label={`Get Lifetime — ${cfg.data?.amount_display ?? "$19.95"}`} />
                  <InstallBtn testID="hero-install" label="Install the App" />
                </View>
                <View style={styles.trustRow}>
                  <Trust icon="shield-check" label="One-time payment" />
                  <Trust icon="infinity" label="Lifetime updates" />
                  <Trust icon="lightning-bolt" label="Works offline" />
                </View>
              </View>
              <View style={[styles.heroArt, wide && { flex: 1 }]}>
                <View style={styles.logoGlow}>
                  <Image
                    testID="hero-logo"
                    source={require("@/assets/images/air-to-drive-logo.jpg")}
                    style={{ width: wide ? 340 : 250, height: (wide ? 340 : 250) / 0.754, borderRadius: 20 }}
                    contentFit="contain"
                  />
                </View>
              </View>
            </View>
          </View>
        </LinearGradient>

        {/* FEATURES */}
        <View style={[styles.sectionInner, { maxWidth: MAX_W }]}>
          <Text style={styles.kicker}>BUILT FOR THE FIELD</Text>
          <Text style={styles.h2}>Three ways people fill drives, not phones</Text>
          <View style={[styles.featureGrid, wide && styles.featureGridWide]}>
            {FEATURES.map((f) => (
              <View key={f.id} testID={f.id} style={[styles.featureCard, wide && { flex: 1 }]}>
                <View style={styles.featureIcon}>
                  <Icon name={f.icon} size={26} color={colors.brandPrimary} />
                </View>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureBody}>{f.body}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* PRICING */}
        <View style={[styles.sectionInner, { maxWidth: MAX_W, alignItems: "center" }]}>
          <Text style={styles.kicker}>SIMPLE PRICING</Text>
          <Text style={styles.h2}>One payment. Yours forever.</Text>
          <View style={styles.pricingCard} testID="pricing-card">
            <LinearGradient colors={["rgba(0,229,255,0.10)", "rgba(10,132,255,0.04)"]} style={styles.pricingGlow} />
            <View style={styles.planBadge}>
              <Text style={styles.planBadgeText}>LIFETIME ACCESS</Text>
            </View>
            <View style={styles.priceRow}>
              <Text style={styles.priceStrike}>$19.95</Text>
              <Text style={styles.priceBig}>${currentPrice}</Text>
              <Text style={styles.priceUnit}>one-time</Text>
              <View style={styles.saleTag}>
                <Text style={styles.saleTagText}>SALE</Text>
              </View>
            </View>
            <View style={styles.bullets}>
              {PRICE_BULLETS.map((b) => (
                <View key={b} style={styles.bulletRow}>
                  <Icon name="check-circle" size={18} color={colors.brandSecondary} />
                  <Text style={styles.bulletText}>{b}</Text>
                </View>
              ))}
            </View>

            <View style={styles.promoWrap}>
              {applied ? (
                <View style={styles.promoApplied} testID="promo-applied">
                  <Icon name="tag-check" size={16} color={colors.brandSecondary} />
                  <Text style={styles.promoAppliedText}>
                    {applied.code} · {applied.pct}% off applied
                  </Text>
                  <Pressable testID="promo-remove" onPress={removePromo} hitSlop={8}>
                    <Icon name="close" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.promoRow}>
                  <TextInput
                    testID="promo-input"
                    value={promo}
                    onChangeText={setPromo}
                    placeholder="Promo code"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    style={styles.promoInput}
                    onSubmitEditing={applyPromo}
                    returnKeyType="done"
                  />
                  <Pressable testID="promo-apply" onPress={applyPromo} style={({ pressed }) => [styles.promoApply, pressed && styles.pressed]}>
                    <Text style={styles.promoApplyText}>Apply</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Pressable testID="buy-button" onPress={() => buy(applied?.code)} disabled={busy} style={({ pressed }) => [styles.btn, styles.btnPrimary, styles.buyFull, pressed && styles.pressed]}>
              <Icon name="lightning-bolt" size={18} color={colors.onBrandPrimary} />
              <Text style={[styles.btnText, styles.btnTextLg, { color: colors.onBrandPrimary }]}>
                {busy ? "Opening checkout…" : "Buy Lifetime Access"}
              </Text>
            </Pressable>
            <View style={styles.secureRow}>
              <Icon name="lock" size={13} color={colors.muted} />
              <Text style={styles.secureText}>
                {cfg.data && !cfg.data.enabled ? "Checkout activates once Stripe keys are added" : "Secure checkout powered by Stripe"}
              </Text>
            </View>
          </View>
        </View>

        {/* FAQ */}
        <View style={[styles.sectionInner, { maxWidth: MAX_W, alignItems: "center" }]}>
          <Text style={styles.kicker}>QUESTIONS</Text>
          <Text style={styles.h2}>Frequently asked</Text>
          <View style={styles.faqMax}>
            {FAQS.map((f, i) => (
              <FaqItem key={f.q} index={i} q={f.q} a={f.a} />
            ))}
          </View>
        </View>

        {/* FOOTER */}
        <View style={[styles.sectionInner, { maxWidth: MAX_W }]}>
          <View style={styles.footer}>
            <View style={styles.brandRow}>
              <View style={styles.logoMark}>
                <Image source={require("@/assets/images/logo-mark.png")} style={styles.logoMarkImg} contentFit="contain" />
              </View>
              <Text style={styles.wordmark}>AIR TO DRIVE</Text>
            </View>
            <Text style={styles.footerText}>Download large files directly to external USB storage — bypassing internal device memory.</Text>
            <Text style={styles.footerMeta}>airtodrive.com · © {new Date().getFullYear()} Air to Drive</Text>
          </View>
        </View>
      </ScrollView>

      {/* AUTO INSTALL PROMPT */}
      {showInstall && !installed ? (
        <View style={styles.overlay} testID="install-prompt">
          <Pressable style={styles.overlayBg} onPress={dismissInstall} />
          <View style={styles.installCard}>
            <Image source={require("@/assets/images/air-to-drive-logo.jpg")} style={styles.installLogo} contentFit="contain" />
            <Text style={styles.installTitle}>Install Air to Drive</Text>
            <Text style={styles.installBody}>
              Add the app to your device for one-tap access and offline use. Installs in seconds — no
              app store required.
            </Text>
            <Pressable testID="install-accept" onPress={doInstall} style={({ pressed }) => [styles.btn, styles.btnPrimary, styles.buyFull, pressed && styles.pressed]}>
              <Icon name="download" size={18} color={colors.onBrandPrimary} />
              <Text style={[styles.btnText, styles.btnTextLg, { color: colors.onBrandPrimary }]}>Install Now</Text>
            </Pressable>
            <Pressable testID="install-dismiss" onPress={dismissInstall} style={styles.laterBtn}>
              <Text style={styles.laterText}>Maybe later</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Trust({ icon, label }: { icon: IconName; label: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.trustItem}>
      <Icon name={icon} size={15} color={colors.muted} />
      <Text style={styles.trustText}>{label}</Text>
    </View>
  );
}

function FaqItem({ index, q, a }: { index: number; q: string; a: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.faqCard} testID={`faq-item-${index}`}>
      <Pressable testID={`faq-toggle-${index}`} onPress={() => setOpen((v) => !v)} style={styles.faqQRow}>
        <Text style={styles.faqQText}>{q}</Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={22} color={colors.brandPrimary} />
      </Pressable>
      {open ? (
        <View style={styles.faqA}>
          <Text style={styles.faqAText}>{a}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },

  nav: { backgroundColor: "rgba(14,14,15,0.9)", borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: spacing.md, paddingHorizontal: spacing.lg, alignItems: "center" },
  navInner: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logoMark: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(0,229,255,0.4)", overflow: "hidden" },
  logoMarkImg: { width: 28, height: 28 },
  faqMax: { width: "100%", maxWidth: 760, alignSelf: "center" },
  faqCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden", marginBottom: spacing.sm },
  faqQRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, minHeight: 56 },
  faqQText: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  faqA: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  faqAText: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  wordmark: { color: colors.onSurface, fontSize: 15, fontWeight: "800", fontFamily: mono, letterSpacing: 1.5 },
  navBtns: { flexDirection: "row", alignItems: "center", gap: spacing.sm },

  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingVertical: 10, paddingHorizontal: spacing.lg, borderRadius: radius.md, minHeight: 44 },
  btnPrimary: { backgroundColor: colors.brandPrimary, boxShadow: `0px 0px 16px ${colors.brandPrimary}80` },
  btnGhost: { backgroundColor: "transparent", borderWidth: 1, borderColor: "rgba(0,229,255,0.4)" },
  btnText: { fontSize: 14, fontWeight: "700", fontFamily: mono, letterSpacing: 0.5 },
  btnTextLg: { fontSize: 16 },
  pressed: { opacity: 0.85 },

  heroBg: { paddingVertical: spacing["3xl"], paddingHorizontal: spacing.lg, alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border },
  sectionInner: { width: "100%", alignSelf: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing["2xl"] },
  heroWrap: { flexDirection: "column", alignItems: "center", gap: spacing["2xl"] },
  heroWrapWide: { flexDirection: "row", alignItems: "center", gap: spacing["3xl"] },
  heroText: { gap: spacing.lg, alignItems: "flex-start" },
  pill: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: "rgba(0,229,255,0.3)", borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: spacing.md },
  pillDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.brandPrimary, boxShadow: `0px 0px 8px ${colors.brandPrimary}` },
  pillText: { color: colors.onBrandTertiary, fontSize: 11, fontFamily: mono, letterSpacing: 1 },
  h1: { color: colors.onSurface, fontSize: 34, fontWeight: "900", lineHeight: 40, letterSpacing: -0.5 },
  h1Wide: { fontSize: 50, lineHeight: 56 },
  h1Accent: { color: colors.brandPrimary },
  sub: { color: colors.onSurfaceSecondary, fontSize: 16, lineHeight: 24, maxWidth: 560 },
  heroBtns: { flexDirection: "row", gap: spacing.md, marginTop: spacing.xs },
  trustRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, marginTop: spacing.sm },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  trustText: { color: colors.muted, fontSize: 12, fontFamily: mono },
  heroArt: { alignItems: "center", justifyContent: "center" },
  logoGlow: { borderRadius: 24, boxShadow: `0px 0px 70px ${colors.brandPrimary}33` },

  kicker: { color: colors.brandPrimary, fontSize: 12, fontFamily: mono, letterSpacing: 2, marginBottom: spacing.sm },
  h2: { color: colors.onSurface, fontSize: 26, fontWeight: "800", marginBottom: spacing.xl, letterSpacing: -0.3 },

  featureGrid: { flexDirection: "column", gap: spacing.lg },
  featureGridWide: { flexDirection: "row", alignItems: "stretch" },
  featureCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, gap: spacing.md },
  featureIcon: { width: 54, height: 54, borderRadius: radius.md, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(0,229,255,0.25)" },
  featureTitle: { color: colors.onSurface, fontSize: 18, fontWeight: "800" },
  featureBody: { color: colors.muted, fontSize: 14, lineHeight: 21 },

  pricingCard: { width: "100%", maxWidth: 440, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: "rgba(0,229,255,0.35)", padding: spacing.xl, overflow: "hidden", boxShadow: `0px 0px 40px ${colors.brandPrimary}40` },
  pricingGlow: { position: "absolute", left: 0, right: 0, top: 0, height: 160 },
  planBadge: { alignSelf: "flex-start", backgroundColor: colors.brandTertiary, borderRadius: radius.sm, paddingVertical: 5, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: "rgba(0,229,255,0.3)" },
  planBadgeText: { color: colors.brandPrimary, fontSize: 11, fontFamily: mono, letterSpacing: 1.5, fontWeight: "700" },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, marginTop: spacing.lg },
  priceBig: { color: colors.onSurface, fontSize: 48, fontWeight: "900", fontFamily: mono, letterSpacing: -1 },
  priceUnit: { color: colors.muted, fontSize: 15, fontFamily: mono },
  priceStrike: { color: colors.muted, fontSize: 20, fontFamily: mono, textDecorationLine: "line-through" },
  saleTag: { backgroundColor: colors.error, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "center" },
  saleTagText: { color: colors.onError, fontSize: 10, fontFamily: mono, fontWeight: "700", letterSpacing: 1 },
  promoWrap: { marginTop: spacing.lg },
  promoRow: { flexDirection: "row", gap: spacing.sm },
  promoInput: { flex: 1, backgroundColor: colors.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontSize: 14, fontFamily: mono, letterSpacing: 1 },
  promoApply: { paddingHorizontal: spacing.lg, borderRadius: radius.md, borderWidth: 1, borderColor: "rgba(0,229,255,0.4)", alignItems: "center", justifyContent: "center", minHeight: 44 },
  promoApplyText: { color: colors.brandPrimary, fontSize: 13, fontFamily: mono, fontWeight: "700" },
  promoApplied: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "rgba(16,185,129,0.12)", borderWidth: 1, borderColor: "rgba(16,185,129,0.4)", borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  promoAppliedText: { flex: 1, color: colors.brandSecondary, fontSize: 13, fontFamily: mono },
  bullets: { marginTop: spacing.xl, gap: spacing.md },
  bulletRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  bulletText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 20 },
  buyFull: { marginTop: spacing.xl, alignSelf: "stretch", paddingVertical: spacing.lg },
  secureRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: spacing.md },
  secureText: { color: colors.muted, fontSize: 12, fontFamily: mono },

  footer: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xl, gap: spacing.sm },
  footerText: { color: colors.muted, fontSize: 13, lineHeight: 20, maxWidth: 520 },
  footerMeta: { color: colors.muted, fontSize: 11, fontFamily: mono, marginTop: spacing.xs },

  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  overlayBg: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.75)" },
  installCard: { width: "100%", maxWidth: 400, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: "rgba(0,229,255,0.35)", padding: spacing.xl, alignItems: "center", gap: spacing.sm, boxShadow: `0px 0px 40px ${colors.brandPrimary}4D` },
  installLogo: { width: 92, height: 122, borderRadius: 16, marginBottom: spacing.xs },
  installTitle: { color: colors.onSurface, fontSize: 20, fontWeight: "800", marginTop: spacing.xs },
  installBody: { color: colors.muted, fontSize: 14, lineHeight: 20, textAlign: "center" },
  laterBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  laterText: { color: colors.muted, fontSize: 13, fontFamily: mono },
}));
