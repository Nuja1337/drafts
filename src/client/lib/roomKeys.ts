// Room key strength (pure, shared by the key store and its tests). Server-issued keys carry a role prefix.

/** host_ (3) > cap_ (2); anything else is unknown (0). */
export const roomKeyRank = (key: string | null | undefined): number => (!key ? 0 : key.startsWith("host_") ? 3 : key.startsWith("cap_") ? 2 : 0);

/** Whether a server-confirmed key should replace the stored one: never a stronger key (a host isn't demoted to captain). */
export const shouldStoreRoomKey = (stored: string | null | undefined, confirmed: string): boolean =>
  stored !== confirmed && (!stored || roomKeyRank(stored) <= roomKeyRank(confirmed));
