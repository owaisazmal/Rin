import React, { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BackButton from '../components/BackButton';
import LogoMark from '../components/LogoMark';
import SegmentedControl from '../components/SegmentedControl';
import ForgotPasswordScreen from './ForgotPasswordScreen';
import { ScreenLayer, useScreenTransition } from '../navigation/ScreenLayer';
import { Account, isEmail } from '../auth';
import { FONT, Palette, useTheme } from '../theme';
import { authStyles } from './authStyles';

type Tab = 'signin' | 'create';

const TABS = [
  { value: 'signin' as Tab, label: 'SIGN IN' },
  { value: 'create' as Tab, label: 'CREATE ACCOUNT' },
] as const;

/**
 * Creating an account asks for two fields signing in doesn't. Matched to the
 * pill's own travel, so the card grows at the pace the switch moves rather than
 * snapping open under it.
 */
const fieldsAnimation = LayoutAnimation.create(240, 'easeInEaseOut', 'opacity');

interface Props {
  /**
   * `onboarding` is the first-open screen and offers a way past it;
   * `standalone` is reached from Settings and offers a way back instead.
   */
  variant: 'onboarding' | 'standalone';
  onAuthenticated: (account: Account) => void;
  onDismiss: () => void;
}

export default function AuthScreen({ variant, onAuthenticated, onDismiss }: Props) {
  const { palette } = useTheme();
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const [tab, setTab] = useState<Tab>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const creating = tab === 'create';

  // Reset pushes over the sign-in form as its own layer rather than replacing
  // it, so the way back is the same slide — or the same edge swipe — as
  // everywhere else in the app.
  const reset = useScreenTransition(forgot);
  const closeReset = () => setForgot(false);

  const switchTab = (next: Tab) => {
    LayoutAnimation.configureNext(fieldsAnimation);
    setTab(next);
    setConfirm('');
    setError(null);
  };

  const submit = () => {
    if (creating && name.trim() === '') {
      setError('Tell us what to call you.');
      return;
    }
    if (!isEmail(email)) {
      setError('That email address looks incomplete.');
      return;
    }
    if (password.length < 6) {
      setError('Passwords need at least 6 characters.');
      return;
    }
    if (creating && confirm !== password) {
      setError("Those passwords don't match.");
      return;
    }
    setError(null);
    onAuthenticated({ name: name.trim(), email: email.trim() });
  };

  const field = (key: string) => ({
    style: [styles.input, focused === key && styles.inputFocused],
    placeholderTextColor: palette.inkSoft,
    onFocus: () => setFocused(key),
    onBlur: () => setFocused((f) => (f === key ? null : f)),
  });

  // Revealing one password field reveals both — hiding half of a pair the user
  // is being asked to compare would defeat the point of asking.
  const secure = { secureTextEntry: !reveal, autoCapitalize: 'none' as const, autoCorrect: false };

  return (
    <>
      <ScreenLayer coveredBy={reset.progress} hidden={reset.settledOpen}>
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          {/*
            Fixed-height bar outside the scroller. The content below is vertically
            centred, so a back button placed inside it would ride up and down with
            the card instead of sitting in the corner — and the bar is rendered in
            both variants so the card lands at the same height either way.
          */}
          <View style={styles.topBar}>
            {variant === 'standalone' ? <BackButton onPress={onDismiss} /> : null}
          </View>

          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.brand}>
                <View style={styles.brandMark}>
                  <LogoMark size={76} />
                </View>
                <Text style={styles.brandSub}>MONTHLY</Text>
                <Text style={styles.brandTitle}>PLANNING</Text>
                <Text style={styles.tagline}>
                  {creating
                    ? 'Start the streak you keep coming back to.'
                    : 'Pick up where your streak left off.'}
                </Text>
              </View>

              <View style={styles.card}>
                <SegmentedControl
                  options={TABS}
                  value={tab}
                  onChange={switchTab}
                  style={styles.segment}
                />

                {creating ? (
                  <View style={styles.fieldBox}>
                    <Text style={styles.label}>NAME</Text>
                    <TextInput
                      {...field('name')}
                      value={name}
                      onChangeText={setName}
                      placeholder="Owais"
                      autoCapitalize="words"
                      autoComplete="name"
                      returnKeyType="next"
                      onSubmitEditing={() => emailRef.current?.focus()}
                    />
                  </View>
                ) : null}

                <View style={styles.fieldBox}>
                  <Text style={styles.label}>EMAIL</Text>
                  <TextInput
                    {...field('email')}
                    ref={emailRef}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    autoComplete="email"
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                  />
                </View>

                <View style={styles.fieldBox}>
                  <View style={styles.labelRow}>
                    <Text style={styles.label}>PASSWORD</Text>
                    <Pressable hitSlop={8} onPress={() => setReveal((r) => !r)}>
                      <Text style={styles.reveal}>{reveal ? 'HIDE' : 'SHOW'}</Text>
                    </Pressable>
                  </View>
                  <TextInput
                    {...field('password')}
                    {...secure}
                    ref={passwordRef}
                    value={password}
                    onChangeText={setPassword}
                    placeholder={creating ? 'At least 6 characters' : '••••••••'}
                    autoComplete={creating ? 'new-password' : 'current-password'}
                    returnKeyType={creating ? 'next' : 'go'}
                    onSubmitEditing={() =>
                      creating ? confirmRef.current?.focus() : submit()
                    }
                  />
                </View>

                {creating ? (
                  <View style={styles.fieldBox}>
                    <Text style={styles.label}>CONFIRM PASSWORD</Text>
                    <TextInput
                      {...field('confirm')}
                      {...secure}
                      ref={confirmRef}
                      value={confirm}
                      onChangeText={setConfirm}
                      placeholder="Type it once more"
                      autoComplete="new-password"
                      returnKeyType="go"
                      onSubmitEditing={submit}
                    />
                    {/* stands down once the submit error says the same thing louder */}
                    {!error && confirm.length > 0 && confirm !== password ? (
                      <Text style={styles.hint}>Not a match yet.</Text>
                    ) : null}
                  </View>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <Pressable
                  onPress={submit}
                  style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.primaryText}>
                    {creating ? 'CREATE ACCOUNT' : 'SIGN IN'}
                  </Text>
                </Pressable>

                {creating ? (
                  <Text style={styles.fine}>
                    Your habits stay on this device. An account is only for keeping them
                    when you change phones.
                  </Text>
                ) : (
                  <Pressable
                    hitSlop={8}
                    onPress={() => setForgot(true)}
                    style={({ pressed }) => [styles.forgot, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.forgotText}>Forgot password?</Text>
                  </Pressable>
                )}
              </View>

              {variant === 'onboarding' ? (
                <Pressable
                  hitSlop={10}
                  onPress={onDismiss}
                  style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.skipText}>Continue without an account</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </ScreenLayer>

      <ScreenLayer transition={reset} onSwipeBack={closeReset}>
        <ForgotPasswordScreen initialEmail={email} onBack={closeReset} />
      </ScreenLayer>
    </>
  );
}

const makeStyles = (p: Palette) => {
  const base = authStyles(p);
  return {
    ...base,
    ...StyleSheet.create({
      primary: { ...base.primary, marginTop: 4 },
      brandMark: {
        marginBottom: 14,
      },
      segment: {
        marginBottom: 18,
      },
      fieldBox: {
        marginBottom: 14,
      },
      labelRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
      },
      reveal: {
        fontSize: 10,
        fontFamily: FONT.bold,
        letterSpacing: 1,
        color: p.accent,
        marginBottom: 6,
      },
      /** live nudge while typing the second password — quieter than a submit error */
      hint: {
        marginTop: 6,
        fontSize: 11,
        fontFamily: FONT.medium,
        color: p.inkSoft,
      },
      forgot: {
        alignSelf: 'center',
        marginTop: 14,
      },
      forgotText: {
        fontSize: 12,
        fontFamily: FONT.medium,
        color: p.inkSoft,
      },
      skip: {
        alignSelf: 'center',
        marginTop: 22,
        paddingVertical: 6,
      },
      skipText: {
        fontSize: 13,
        fontFamily: FONT.semibold,
        color: p.inkSoft,
        textDecorationLine: 'underline',
      },
    }),
  };
};
