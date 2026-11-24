export declare const NETWORK_SECURITY_CONFIG_XML: string;
export declare const FILE_PATHS_XML: string;
export declare const LIGHT_THEME_XML: string;
export declare const PROGUARD_BRIDGE_RULE: string;
export declare const MAIN_ACTIVITY_KT: string;
export declare function patchAndroidManifest(manifestXml: string): string;
export declare function patchProguardRules(existingRules: string): string;
export declare function computeAndroidVersionCode(versionName: string): number;
export declare function syncAndroidLauncherIcons(iconsAndroidDir: string, resDir: string): number;
