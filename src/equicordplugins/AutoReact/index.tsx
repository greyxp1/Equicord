/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare global {
    interface Window {
        EmojiMart?: {
            Picker: new (options: any) => HTMLElement;
        };
        EmojiMartLoading?: boolean;
        EmojiMartLoaded?: boolean;
    }
}

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { openPluginModal } from "@components/PluginSettings/PluginModal";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Forms, Menu, React, RestAPI, Toasts } from "@webpack/common";

import Plugins from "~plugins";

interface EmojiPickerProps {
    onSelect: (emoji: string) => void;
    onClose: () => void;
}

function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
    const pickerRef = React.useRef<HTMLDivElement>(null);
    const [ready, setReady] = React.useState(false);

    React.useEffect(() => {
        if (window.EmojiMartLoaded) {
            setReady(true);
            return;
        }

        if (!window.EmojiMartLoading) {
            window.EmojiMartLoading = true;
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = "https://cdn.jsdelivr.net/npm/emoji-mart@latest/css/emoji-mart.css";
            document.head.appendChild(link);

            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/emoji-mart@latest/dist/browser.js";
            script.async = true;
            script.onload = () => {
                window.EmojiMartLoaded = true;
                setReady(true);
            };
            document.body.appendChild(script);
        } else {
            const interval = setInterval(() => {
                if (window.EmojiMartLoaded) {
                    setReady(true);
                    clearInterval(interval);
                }
            }, 100);
            return () => clearInterval(interval);
        }
    }, []);

    React.useEffect(() => {
        if (!ready || !pickerRef.current || !window.EmojiMart) return;

        const picker = new window.EmojiMart.Picker({
            onEmojiSelect: (emoji: any) => {
                onSelect(emoji.native);
                onClose();
            },
            theme: "dark",
            previewPosition: "none",
            searchPosition: "static",
            perLine: 8,
            emojiSize: 24,
            emojiButtonSize: 36,
            navPosition: "top"
        });
        pickerRef.current.appendChild(picker);

        const handleOutsideClick = (event: MouseEvent) => {
            if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        document.addEventListener("mousedown", handleOutsideClick);
        return () => {
            if (pickerRef.current) pickerRef.current.innerHTML = "";
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, [ready]);

    return (
        <div className="auto-react-emoji-picker">
            {!ready ? (
                <div className="auto-react-emoji-picker-loading">Loading emoji picker...</div>
            ) : (
                <div ref={pickerRef} />
            )}
        </div>
    );
}

function EmojiPickerButton({ onSelect, initialEmoji = "💀" }: { onSelect: (emoji: string) => void; initialEmoji?: string; }) {
    const [showPicker, setShowPicker] = React.useState(false);
    const [currentEmoji, setCurrentEmoji] = React.useState(initialEmoji);

    return (
        <div className="auto-react-emoji-container">
            <button
                className="auto-react-emoji-display-button"
                onClick={() => setShowPicker(true)}
                aria-label="Select emoji"
            >
                {currentEmoji}
            </button>
            {showPicker && (
                <EmojiPicker
                    onSelect={emoji => {
                        setCurrentEmoji(emoji);
                        onSelect(emoji);
                        setShowPicker(false);
                    }}
                    onClose={() => setShowPicker(false)}
                />
            )}
        </div>
    );
}

const parseSettings = (value: string | any, defaultValue: any) =>
    typeof value === "string" ? JSON.parse(value) : value || defaultValue;

// In-memory storage with persistence
const blacklistedUsers = new Set<string>();
const channelSettings = new Map<string, string>();

const rateLimitTracker = {
    lastRequest: 0,
    minDelay: 50,
    async addReaction(channelId: string, messageId: string, emoji: string) {
        const now = Date.now();
        if (now - this.lastRequest < this.minDelay) {
            await new Promise(resolve => setTimeout(resolve, this.minDelay - (now - this.lastRequest)));
        }
        try {
            await RestAPI.put({
                url: `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me?location=Message%20Inline%20Button&type=0`
            });
            this.lastRequest = Date.now();
        } catch (err) {
            console.error("[AutoReact] Failed to add reaction:", err);
        }
    }
};

const BlacklistedUsersList = () => (
    <Forms.FormSection>
        <Forms.FormText>
            {blacklistedUsers.size === 0 ? "No users currently blacklisted." : `${blacklistedUsers.size} user${blacklistedUsers.size === 1 ? "" : "s"} blacklisted.`}
        </Forms.FormText>
    </Forms.FormSection>
);

const ChannelSettingsList = () => {
    const [expanded, setExpanded] = React.useState(false);
    const channels = Array.from(channelSettings.entries());

    return (
        <Forms.FormSection>
            <Forms.FormText>
                {channels.length === 0 ? "No channels currently enabled." : `${channels.length} channel${channels.length === 1 ? "" : "s"} enabled.`}
            </Forms.FormText>
            {channels.length > 0 && (
                <>
                    <button
                        className="auto-react-expand-button"
                        onClick={() => setExpanded(!expanded)}
                    >
                        {expanded ? "Hide Channels" : "Show Channels"}
                    </button>
                    {expanded && (
                        <div className="auto-react-channels-list">
                            {channels.map(([channelId, emoji]) => (
                                <div key={channelId} className="auto-react-channel-item">
                                    <span className="auto-react-channel-name">
                                        {channelId}
                                    </span>
                                    <EmojiPickerButton
                                        onSelect={newEmoji => {
                                            channelSettings.set(channelId, newEmoji);
                                            settings.store.channelSettings = JSON.stringify(Array.from(channelSettings.entries()));
                                        }}
                                        initialEmoji={emoji}
                                    />
                                    <button
                                        className="auto-react-remove-channel"
                                        onClick={() => {
                                            channelSettings.delete(channelId);
                                            settings.store.channelSettings = JSON.stringify(Array.from(channelSettings.entries()));
                                        }}
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </Forms.FormSection>
    );
};

const channelContextMenuPatch: NavContextMenuPatchCallback = (children, { channel }) => {
    if (!channel) return;
    const isEnabled = channelSettings.has(channel.id);

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="auto-react-toggle"
            label={isEnabled ? "Disable Auto-React" : "Enable Auto-React"}
            action={() => {
                if (isEnabled) {
                    channelSettings.delete(channel.id);
                } else {
                    channelSettings.set(channel.id, "💀");
                }
                settings.store.channelSettings = JSON.stringify(Array.from(channelSettings.entries()));
                Toasts.show({
                    message: `Auto-React ${!isEnabled ? "enabled" : "disabled"} for this channel`,
                    type: Toasts.Type.SUCCESS,
                    id: Toasts.genId()
                });
            }}
        />,
        <Menu.MenuItem
            id="auto-react-open"
            label="Open Auto-React Settings"
            action={() => openPluginModal(Plugins.AutoReact)}
        />
    );
};

const userContextMenuPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user) return;
    const isBlacklisted = blacklistedUsers.has(user.id);

    children.push(
        <Menu.MenuSeparator />,
        <Menu.MenuItem
            id="auto-react-blacklist"
            label={isBlacklisted ? "Remove from Auto-React Blacklist" : "Add to Auto-React Blacklist"}
            action={() => {
                if (isBlacklisted) {
                    blacklistedUsers.delete(user.id);
                } else {
                    blacklistedUsers.add(user.id);
                }
                settings.store.blacklistedUsers = JSON.stringify(Array.from(blacklistedUsers));
                Toasts.show({
                    message: `User ${isBlacklisted ? "removed from" : "added to"} Auto-React blacklist`,
                    type: Toasts.Type.SUCCESS,
                    id: Toasts.genId()
                });
            }}
        />
    );
};

const DEFAULT_SETTINGS = {
    blacklistedUsers: "[]",
    channelSettings: "[]"
};

const settings = definePluginSettings({
    blacklistedUsers: {
        type: OptionType.COMPONENT,
        description: "Blacklisted Users",
        component: BlacklistedUsersList,
        default: DEFAULT_SETTINGS.blacklistedUsers
    },
    channelSettings: {
        type: OptionType.COMPONENT,
        description: "Enabled Channels",
        component: ChannelSettingsList,
        default: DEFAULT_SETTINGS.channelSettings
    }
});

export default definePlugin({
    name: "AutoReact",
    description: "Automatically reacts to messages with specified emojis. Configure settings in the channel's context menu.",
    authors: [Devs.Greyxp1],
    settings,

    start() {
        // Initialize Sets from stored settings
        const storedBlacklistedUsers = parseSettings(settings.store.blacklistedUsers, []);
        storedBlacklistedUsers.forEach(id => blacklistedUsers.add(id));

        // Initialize channel settings
        const storedChannels = parseSettings(settings.store.channelSettings, []);
        if (Array.isArray(storedChannels)) {
            storedChannels.forEach(([channelId, emoji]) => {
                channelSettings.set(channelId, emoji);
            });
        }

        FluxDispatcher.subscribe("MESSAGE_CREATE", this.handleMessage);
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", this.handleMessage);
    },

    contextMenus: {
        "channel-context": channelContextMenuPatch,
        "user-context": userContextMenuPatch
    },

    handleMessage({ type, channelId, message, optimistic }) {
        if (type !== "MESSAGE_CREATE" || optimistic) return;
        if (!channelSettings.has(channelId)) return;
        if (blacklistedUsers.has(message.author?.id)) return;

        const emoji = channelSettings.get(channelId)?.trim();
        if (!emoji) return;

        rateLimitTracker.addReaction(channelId, message.id, emoji);
    }
});
