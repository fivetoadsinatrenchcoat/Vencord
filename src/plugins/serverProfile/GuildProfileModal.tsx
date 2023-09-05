/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { classNameFactory } from "@api/Styles";
import { openImageModal, openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import { ModalRoot, ModalSize, openModal } from "@utils/modal";
import { LazyComponent, useAwaiter } from "@utils/react";
import { findByCode, findByPropsLazy } from "@webpack";
import { FluxDispatcher, Forms, GuildChannelStore, GuildMemberStore, Parser, PresenceStore, RelationshipStore, ScrollerThin, SnowflakeUtils, TabBar, useEffect, UserStore, UserUtils, useState, useStateFromStores } from "@webpack/common";
import { Guild, User } from "discord-types/general";

const IconUtils = findByPropsLazy("getGuildBannerURL");
const IconClasses = findByPropsLazy("icon", "acronym", "childWrapper");
const UserRow = LazyComponent(() => findByCode(".listDiscriminator"));

const cl = classNameFactory("vc-gp-");

export function openGuildProfileModal(guild: Guild) {
    openModal(props =>
        <ModalRoot {...props} size={ModalSize.MEDIUM}>
            <GuildProfileModal guild={guild} />
        </ModalRoot>
    );
}

const Tabs = {
    ServerInfo: {
        label: "Server Info",
        component: ServerInfoTab
    },
    Friends: {
        label: "Friends",
        component: FriendsTab
    },
    BlockedUsers: {
        label: "Blocked Users",
        component: BlockedUsersTab
    }
} as const;

type TabKeys = keyof typeof Tabs;

interface GuildProps {
    guild: Guild;
}

const fetched = {
    friends: false,
    blocked: false
};

function GuildProfileModal({ guild }: GuildProps) {
    useEffect(() => {
        fetched.friends = false;
        fetched.blocked = false;
    }, []);

    const [currentTab, setCurrentTab] = useState<TabKeys>("ServerInfo");

    const Tab = Tabs[currentTab].component;

    const bannerUrl = guild.banner && IconUtils.getGuildBannerURL({
        id: guild.id,
        banner: guild.banner
    }, true).replace(/\?size=\d+$/, "?size=1024");

    const iconUrl = guild.icon && IconUtils.getGuildIconURL({
        id: guild.id,
        icon: guild.icon,
        canAnimate: true,
        size: 512
    });

    return (
        <div className={cl("root")}>
            {bannerUrl && currentTab === "ServerInfo" && (
                <img
                    className={cl("banner")}
                    src={bannerUrl}
                    alt=""
                    onClick={() => openImageModal(bannerUrl)}
                />
            )}

            <div className={cl("header")}>
                {guild.icon
                    ? <img
                        src={iconUrl}
                        alt=""
                        onClick={() => openImageModal(iconUrl)}
                    />
                    : <div aria-hidden className={classes(IconClasses.childWrapper, IconClasses.acronym)}>{guild.acronym}</div>
                }

                <div className={cl("name-and-description")}>
                    <Forms.FormTitle tag="h5" className={cl("name")}>{guild.name}</Forms.FormTitle>
                    {guild.description && <Forms.FormText>{guild.description}</Forms.FormText>}
                </div>
            </div>

            <TabBar
                type="top"
                look="brand"
                className={cl("tab-bar")}
                selectedItem={currentTab}
                onItemSelect={setCurrentTab}
            >
                {Object.entries(Tabs).map(([id, { label }]) =>
                    <TabBar.Item
                        className={cl("tab", { selected: currentTab === id })}
                        id={id}
                        key={id}
                    >
                        {label}
                    </TabBar.Item>
                )}
            </TabBar>

            <div className={cl("tab-content")}>
                <Tab guild={guild} />
            </div>
        </div>
    );
}


const dateFormat = new Intl.DateTimeFormat(void 0, { timeStyle: "short", dateStyle: "medium" });
function renderTimestampFromId(id: string) {
    return dateFormat.format(SnowflakeUtils.extractTimestamp(id));
}

function Owner(guildId: string, owner: User) {
    const guildAvatar = GuildMemberStore.getMember(guildId, owner.id)?.avatar;
    const ownerAvatarUrl =
        guildAvatar
            ? IconUtils.getGuildMemberAvatarURLSimple({
                userId: owner!.id,
                avatar: guildAvatar,
                guildId,
                canAnimate: true
            }, true)
            : IconUtils.getUserAvatarURL(owner, true);

    return (
        <div className={cl("owner")}>
            <img src={ownerAvatarUrl} alt="" onClick={() => openImageModal(ownerAvatarUrl)} />
            {Parser.parse(`<@${owner.id}>`)}
        </div>
    );
}

function ServerInfoTab({ guild }: GuildProps) {
    const [owner] = useAwaiter(() => UserUtils.fetchUser(guild.ownerId), {
        deps: [guild.ownerId],
        fallbackValue: null
    });

    const Fields = {
        "Server Owner": owner ? Owner(guild.id, owner) : "Loading...",
        "Created At": renderTimestampFromId(guild.id),
        "Joined At": dateFormat.format(guild.joinedAt),
        "Vanity Link": guild.vanityURLCode ? `discord.gg/${guild.vanityURLCode}` : "-",
        "Preferred Locale": guild.preferredLocale || "-",
        "Verification Level": ["None", "Low", "Medium", "High", "Highest"][guild.verificationLevel] || "?",
        "Nitro Boosts": `${guild.premiumSubscriberCount ?? 0} (Level ${guild.premiumTier ?? 0})`,
        "Channels": GuildChannelStore.getChannels(guild.id)?.count - 1 || "?", // - null category
        "Roles": Object.keys(guild.roles).length - 1, // - @everyone
    };

    return (
        <div className={cl("info")}>
            {Object.entries(Fields).map(([name, node]) =>
                <div className={cl("server-info-pair")} key={name}>
                    <Forms.FormTitle tag="h5">{name}</Forms.FormTitle>
                    {typeof node === "string" ? <span>{node}</span> : node}
                </div>
            )}
        </div>
    );
}

function FriendsTab({ guild }: GuildProps) {
    return UserList("friends", guild, RelationshipStore.getFriendIDs());
}

function BlockedUsersTab({ guild }: GuildProps) {
    const blockedIds = Object.keys(RelationshipStore.getRelationships()).filter(id => RelationshipStore.isBlocked(id));
    return UserList("blocked", guild, blockedIds);
}

function UserList(type: "friends" | "blocked", guild: Guild, ids: string[]) {
    const missing = [] as string[];
    const members = [] as string[];

    for (const id of ids) {
        if (GuildMemberStore.isMember(guild.id, id))
            members.push(id);
        else
            missing.push(id);
    }

    // Used for side effects (rerender on member request success)
    useStateFromStores(
        [GuildMemberStore],
        () => GuildMemberStore.getMemberIds(guild.id),
        null,
        (old, curr) => old.length === curr.length
    );

    useEffect(() => {
        if (!fetched[type] && missing.length) {
            fetched[type] = true;
            FluxDispatcher.dispatch({
                type: "GUILD_MEMBERS_REQUEST",
                guildIds: [guild.id],
                userIds: missing
            });
        }
    }, []);

    return (
        <ScrollerThin fade className={cl("scroller")}>
            {members.map(id =>
                <UserRow
                    user={UserStore.getUser(id)}
                    status={PresenceStore.getStatus(id) || "offline"}
                    onSelect={() => openUserProfile(id)}
                    onContextMenu={() => { }}
                />
            )}
        </ScrollerThin>
    );
}