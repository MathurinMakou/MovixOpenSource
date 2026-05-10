import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { PrefetchLink as Link } from '@/routing/PrefetchLink';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { ArrowRight, Crown, ExternalLink, List, ShieldCheck, UserRound, UserRoundCog } from 'lucide-react';
import { Button } from '../components/ui/button';
import { discordAuth } from '../services/discordAuth';
import { googleAuth } from '../services/googleAuth';
import { broadcastAuthChange, clearPendingAuthAction, clearStoredAuthSession, setPendingAuthAuthorize } from '../utils/accountAuth';

const API_URL = import.meta.env.VITE_MAIN_API;
const DEFAULT_AVATAR = 'https://as2.ftcdn.net/v2/jpg/05/89/93/27/1000_F_589932782_vQAEAZhHnq1QCGu5ikwrYaQD0Mmurm0N.webp';
const MOVIX_LOGO_SRC = '/movix.png';

interface OAuthPreviewResponse {
  success: boolean;
  client: {
    clientId: string;
    clientName: string;
    description?: string | null;
    homepageUrl?: string | null;
    logoUrl?: string | null;
    publicClient: boolean;
    requirePkce: boolean;
    allowedScopes: string[];
    redirectOrigins: string[];
  };
  request: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
    requiresPkce: boolean;
    codeChallengeMethod?: string | null;
    codeChallengeProvided: boolean;
    codeExpiresInMs: number;
    accessTokenExpiresInMs: number;
  };
}

interface OAuthPreviewApiPayload {
  success?: boolean;
  error?: string;
  error_description?: string;
  client?: OAuthPreviewResponse['client'];
  request?: OAuthPreviewResponse['request'];
}

interface StoredIdentity {
  username: string;
  avatar: string;
}

function getStoredIdentity(): StoredIdentity | null {
  const authRaw = localStorage.getItem('auth');
  if (authRaw) {
    try {
      const parsed = JSON.parse(authRaw);
      const userProfile = parsed?.userProfile;
      if (userProfile && typeof userProfile === 'object') {
        return {
          username: String(userProfile.username || userProfile.name || 'Movix'),
          avatar: String(userProfile.avatar || DEFAULT_AVATAR),
        };
      }
    } catch {
      // Ignore malformed local auth cache.
    }
  }

  const googleRaw = localStorage.getItem('google_user');
  if (googleRaw) {
    try {
      const parsed = JSON.parse(googleRaw);
      return {
        username: String(parsed?.name || 'Movix'),
        avatar: String(parsed?.picture || DEFAULT_AVATAR),
      };
    } catch {
      // Ignore malformed local auth cache.
    }
  }

  const discordRaw = localStorage.getItem('discord_user');
  if (discordRaw) {
    try {
      const parsed = JSON.parse(discordRaw);
      return {
        username: String(parsed?.username || 'Movix'),
        avatar: String(parsed?.avatar || DEFAULT_AVATAR),
      };
    } catch {
      // Ignore malformed local auth cache.
    }
  }

  return null;
}

function formatTokenLifetime(ms: number, t: (key: string, options?: Record<string, unknown>) => string) {
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) {
    return t('oauthAuthorize.tokenLifetimeDays', { count: days });
  }

  const hours = Math.max(1, Math.round(ms / (60 * 60 * 1000)));
  return t('oauthAuthorize.tokenLifetimeHours', { count: hours });
}

const OAuthAuthorizePage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [preview, setPreview] = useState<OAuthPreviewResponse | null>(null);
  const [previewClient, setPreviewClient] = useState<OAuthPreviewResponse['client'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authToken = localStorage.getItem('auth_token');
  const accountIdentity = useMemo(() => getStoredIdentity(), []);
  const returnTo = `${location.pathname}${location.search}`;
  const isAlreadyConnected = Boolean(authToken);

  useEffect(() => {
    let cancelled = false;

    const loadPreview = async () => {
      setIsLoading(true);
      setError(null);
      setPreviewClient(null);

      try {
        const response = await fetch(`${API_URL}/api/oauth/authorize/preview?${searchParams.toString()}`);
        const payload = await response.json() as OAuthPreviewApiPayload;

        if (!response.ok || !payload.success) {
          if (payload.client) {
            setPreviewClient(payload.client);
          }
          throw new Error(payload.error_description || payload.error || t('oauthAuthorize.errors.invalidRequest'));
        }

        if (!cancelled) {
          setPreview(payload as OAuthPreviewResponse);
          if (payload.client) {
            setPreviewClient(payload.client);
          }
        }
      } catch (previewError) {
        if (!cancelled) {
          const message = previewError instanceof Error
            ? previewError.message
            : t('oauthAuthorize.errors.invalidRequest');
          setError(message);
          setPreview(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [searchParams, t]);

  useEffect(() => {
    if (!preview) return;
    setPendingAuthAuthorize(returnTo, preview.client.clientId);
  }, [preview, returnTo]);

  const requestedScopes = useMemo(() => {
    const scopeConfig: Record<string, { icon: typeof UserRound; titleKey: string; descKey: string }> = {
      'profile.read': { icon: UserRound, titleKey: 'oauthAuthorize.scopes.profileRead.title', descKey: 'oauthAuthorize.scopes.profileRead.description' },
      'profile.list': { icon: List, titleKey: 'oauthAuthorize.scopes.profileList.title', descKey: 'oauthAuthorize.scopes.profileList.description' },
      'profile.manage': { icon: UserRoundCog, titleKey: 'oauthAuthorize.scopes.profileManage.title', descKey: 'oauthAuthorize.scopes.profileManage.description' },
      'vip.read': { icon: ShieldCheck, titleKey: 'oauthAuthorize.scopes.vipRead.title', descKey: 'oauthAuthorize.scopes.vipRead.description' },
      'vip.manage': { icon: Crown, titleKey: 'oauthAuthorize.scopes.vipManage.title', descKey: 'oauthAuthorize.scopes.vipManage.description' },
    };

    return (preview?.request.scopes || []).map((scope) => {
      const config = scopeConfig[scope] || { icon: ShieldCheck, titleKey: scope, descKey: scope };
      return {
        scope,
        icon: config.icon,
        title: t(config.titleKey),
        description: t(config.descKey),
      };
    });
  }, [preview?.request.scopes, t]);

  const handleProviderLogin = (provider: 'discord' | 'google') => {
    if (provider === 'discord') {
      discordAuth.login({
        mode: 'authorize',
        returnTo,
        clientId: preview?.client.clientId,
      });
      return;
    }

    googleAuth.login({
      mode: 'authorize',
      returnTo,
      clientId: preview?.client.clientId,
    });
  };

  const handleBip39Route = (targetPath: '/login-bip39' | '/create-account') => {
    setPendingAuthAuthorize(returnTo, preview?.client.clientId);
    window.location.replace(targetPath);
  };

  const handleSwitchAccount = () => {
    clearPendingAuthAction();
    clearStoredAuthSession();
    broadcastAuthChange();
    window.location.reload();
  };

  const handleDecision = async (approve: boolean) => {
    if (!preview || !authToken) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/oauth/authorize/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          client_id: preview.request.clientId,
          redirect_uri: preview.request.redirectUri,
          scope: preview.request.scopes.join(' '),
          state: preview.request.state,
          code_challenge_method: searchParams.get('code_challenge_method'),
          code_challenge: searchParams.get('code_challenge'),
          approve,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error_description || payload.error || t('oauthAuthorize.errors.decisionFailed'));
      }

      clearPendingAuthAction();
      window.location.replace(payload.redirectTo);
    } catch (decisionError) {
      const message = decisionError instanceof Error
        ? decisionError.message
        : t('oauthAuthorize.errors.decisionFailed');
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const redirectHost = useMemo(() => {
    try {
      return preview ? new URL(preview.request.redirectUri).origin : null;
    } catch {
      return null;
    }
  }, [preview]);

  return (
    <div className="min-h-[100svh] overflow-x-hidden bg-[radial-gradient(circle_at_top,_rgba(239,68,68,0.18),_transparent_35%),linear-gradient(180deg,_#050505,_#0b0b10_45%,_#111827)] text-white">
      <div className="mx-auto flex min-h-[100svh] w-full max-w-6xl items-center justify-center overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 lg:overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: 'easeOut' }}
          className="grid w-full gap-4 lg:grid-cols-[1.25fr_0.75fr]"
        >
          <section className="rounded-3xl border border-white/10 bg-white/5 p-4 shadow-2xl backdrop-blur-md sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 shadow-lg shadow-black/20">
                  <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/30">
                    <img src={MOVIX_LOGO_SRC} alt="Movix" className="h-5 w-5 object-contain" />
                  </span>
                  <span className="text-left">
                    <span className="block text-[0.6rem] font-semibold uppercase tracking-[0.35em] text-red-200/80">
                      Movix
                    </span>
                    <span className="block text-xs font-medium text-white">OAuth</span>
                  </span>
                </div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-red-300/80">
                  {t('oauthAuthorize.eyebrow')}
                </p>
                <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
                  {t('oauthAuthorize.title')}
                </h1>
                <p className="max-w-2xl text-sm leading-5 text-gray-300">
                  {t('oauthAuthorize.subtitle')}
                </p>
              </div>
              <div className="hidden rounded-2xl border border-red-500/30 bg-red-500/10 p-2 text-red-200 lg:block">
                <ShieldCheck className="h-6 w-6" />
              </div>
            </div>

            {isLoading ? (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5 text-sm text-gray-300">
                {t('oauthAuthorize.loading')}
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
                <p className="font-medium">{t('oauthAuthorize.errorTitle')}</p>
                <p className="mt-2 text-red-100/80">{error}</p>
                {previewClient?.homepageUrl && (
                  <a
                    href={previewClient.homepageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-2 text-sm font-medium text-white transition hover:bg-white/10"
                  >
                    {t('oauthAuthorize.visitSite')}
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <Link to="/" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-red-200 hover:text-white">
                  {t('oauthAuthorize.backHome')}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : preview ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/5">
                      {preview.client.logoUrl ? (
                        <img src={preview.client.logoUrl} alt={preview.client.clientName} className="h-full w-full object-cover" />
                      ) : (
                        <ShieldCheck className="h-5 w-5 text-red-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.65rem] uppercase tracking-[0.25em] text-gray-400">
                        {t('oauthAuthorize.appLabel')}
                      </p>
                      <h2 className="text-lg font-semibold text-white">
                        {preview.client.clientName}
                      </h2>
                      {preview.client.description && (
                        <p className="text-xs leading-4 text-gray-300">
                          {preview.client.description}
                        </p>
                      )}
                    </div>
                    {preview.client.homepageUrl && (
                      <a
                        href={preview.client.homepageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white transition hover:bg-white/10"
                      >
                        {t('oauthAuthorize.visitSite')}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                    <p className="text-[0.65rem] uppercase tracking-[0.25em] text-gray-400">
                      {t('oauthAuthorize.redirectLabel')}
                    </p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {redirectHost || preview.request.redirectUri}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                    <p className="text-[0.65rem] uppercase tracking-[0.25em] text-gray-400">
                      {t('oauthAuthorize.tokenLabel')}
                    </p>
                    <p className="mt-1 text-sm font-medium text-white">
                      {formatTokenLifetime(preview.request.accessTokenExpiresInMs, t)}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                  <p className="text-[0.65rem] uppercase tracking-[0.25em] text-gray-400">
                    {t('oauthAuthorize.permissionsLabel')}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {requestedScopes.map((scopeItem) => {
                      const Icon = scopeItem.icon;
                      return (
                        <div key={scopeItem.scope} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
                          <div className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-red-200">
                            <Icon className="h-3.5 w-3.5" />
                          </div>
                          <p className="min-w-0 truncate text-sm font-medium text-white">
                            {scopeItem.title}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {authToken ? (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <img
                        src={accountIdentity?.avatar || DEFAULT_AVATAR}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-full border border-white/10 object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.65rem] uppercase tracking-[0.25em] text-emerald-200/80">{t('oauthAuthorize.signedInAs')}</p>
                        <p className="truncate font-medium text-white">{accountIdentity?.username || t('oauthAuthorize.connectedAccount')}</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="outline"
                          onClick={() => handleDecision(false)}
                          disabled={isSubmitting}
                          className="border-white/15 bg-transparent px-3 py-1.5 text-sm"
                        >
                          {t('oauthAuthorize.deny')}
                        </Button>
                        <Button
                          onClick={() => handleDecision(true)}
                          disabled={isSubmitting}
                          className="bg-red-600 px-4 py-1.5 text-sm hover:bg-red-700"
                        >
                          {isSubmitting ? t('oauthAuthorize.processing') : t('oauthAuthorize.approve')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4">
                    <p className="text-sm font-medium text-amber-100">
                      {t('oauthAuthorize.loginRequiredTitle')}
                    </p>
                    <p className="mt-1.5 text-sm leading-5 text-amber-50/80">
                      {t('oauthAuthorize.loginRequiredDescription')}
                    </p>
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <aside className="rounded-3xl border border-white/10 bg-black/25 p-4 shadow-2xl backdrop-blur-md">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.35em] text-gray-400">
              {isAlreadyConnected ? t('oauthAuthorize.connectedAccount') : t('oauthAuthorize.connectMovix')}
            </p>
            {isAlreadyConnected ? (
              <div className="mt-2.5 rounded-2xl border border-emerald-400/20 bg-emerald-500/10 p-3.5">
                <div className="flex items-center gap-3">
                  <img
                    src={accountIdentity?.avatar || DEFAULT_AVATAR}
                    alt={accountIdentity?.username || 'Movix'}
                    className="h-10 w-10 rounded-full border border-white/10 object-cover"
                  />
                  <div className="min-w-0">
                    <p className="text-[0.65rem] uppercase tracking-[0.28em] text-emerald-200/80">
                      {t('oauthAuthorize.signedInAs')}
                    </p>
                    <p className="truncate text-base font-semibold text-white">
                      {accountIdentity?.username || t('oauthAuthorize.connectedAccount')}
                    </p>
                  </div>
                </div>

                <h2 className="mt-3 text-lg font-semibold text-white">
                  {t('oauthAuthorize.notYouPrompt', { username: accountIdentity?.username || t('oauthAuthorize.connectedAccount') })}
                </h2>
                <p className="mt-1.5 text-sm leading-5 text-emerald-50/80">
                  {t('oauthAuthorize.switchAccountDescription')}
                </p>

                <Button
                  onClick={handleSwitchAccount}
                  disabled={!preview}
                  className="mt-3 w-full justify-center bg-red-600 hover:bg-red-700"
                >
                  {t('oauthAuthorize.switchAccountCta')}
                </Button>
              </div>
            ) : (
              <>
                <h2 className="mt-3 text-xl font-semibold text-white">
                  {t('oauthAuthorize.loginCardTitle')}
                </h2>
                <p className="mt-2 text-sm leading-5 text-gray-300">
                  {t('oauthAuthorize.loginCardDescription')}
                </p>

                <div className="mt-5 space-y-2.5">
                  <Button
                    onClick={() => handleProviderLogin('discord')}
                    disabled={!preview}
                    className="w-full justify-center bg-[#5865F2] py-2.5 hover:bg-[#4752C4]"
                  >
                    {t('auth.loginWithDiscord')}
                  </Button>
                  <Button
                    onClick={() => handleProviderLogin('google')}
                    disabled={!preview}
                    className="w-full justify-center bg-white py-2.5 text-gray-900 hover:bg-gray-100"
                  >
                    {t('auth.loginWithGoogle')}
                  </Button>
                  <Button
                    onClick={() => handleBip39Route('/login-bip39')}
                    disabled={!preview}
                    variant="secondary"
                    className="w-full justify-center py-2.5"
                  >
                    {t('oauthAuthorize.loginWithBip39')}
                  </Button>
                  <Button
                    onClick={() => handleBip39Route('/create-account')}
                    disabled={!preview}
                    variant="outline"
                    className="w-full justify-center border-white/15 bg-transparent py-2.5"
                  >
                    {t('oauthAuthorize.createMovixAccount')}
                  </Button>
                </div>
              </>
            )}

            <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-sm font-medium text-white">{t('oauthAuthorize.securityTitle')}</p>
              <p className="mt-1 text-xs leading-4 text-gray-400">
                {t('oauthAuthorize.securityDescription')}
              </p>
            </div>
          </aside>
        </motion.div>
      </div>
    </div>
  );
};

export default OAuthAuthorizePage;
