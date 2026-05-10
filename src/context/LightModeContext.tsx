import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

type LightModeSetting = 'auto' | 'on' | 'off';

interface LightModeContextType {
  isLightMode: boolean;
  lightModeSetting: LightModeSetting;
  setLightModeSetting: (setting: LightModeSetting) => void;
}

const LightModeContext = createContext<LightModeContextType | undefined>(undefined);

function detectWeakDevice(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('tizen') || ua.includes('webos') || ua.includes('web0s') ||
      ua.includes('smarttv') || ua.includes('smart-tv') || ua.includes('nettv') ||
      ua.includes('appletv') || ua.includes('roku') || ua.includes('firetv') ||
      ua.includes('philipstv') || ua.includes('hbbtv')) {
    return true;
  }
  if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) {
    return true;
  }
  if ((navigator as any).deviceMemory && (navigator as any).deviceMemory <= 2) {
    return true;
  }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return true;
  }
  return false;
}

export const LightModeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lightModeSetting, setLightModeSettingState] = useState<LightModeSetting>(() => {
    return (localStorage.getItem('settings_light_mode') as LightModeSetting) || 'auto';
  });

  const isLightMode = useMemo(() => {
    if (lightModeSetting === 'on') return true;
    if (lightModeSetting === 'off') return false;
    return detectWeakDevice();
  }, [lightModeSetting]);

  const setLightModeSetting = useCallback((setting: LightModeSetting) => {
    setLightModeSettingState(setting);
    localStorage.setItem('settings_light_mode', setting);
  }, []);

  useEffect(() => {
    if (isLightMode) {
      document.documentElement.setAttribute('data-light-mode', 'true');
    } else {
      document.documentElement.removeAttribute('data-light-mode');
    }
  }, [isLightMode]);

  const value = useMemo(
    () => ({ isLightMode, lightModeSetting, setLightModeSetting }),
    [isLightMode, lightModeSetting, setLightModeSetting]
  );

  return (
    <LightModeContext.Provider value={value}>
      {children}
    </LightModeContext.Provider>
  );
};

export const useLightMode = () => {
  const context = useContext(LightModeContext);
  if (context === undefined) {
    throw new Error('useLightMode must be used within a LightModeProvider');
  }
  return context;
};
