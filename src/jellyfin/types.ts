/** The parts of Jellyfin's responses the app uses. */

export interface UserPolicy {
  IsAdministrator: boolean;
  EnableContentDeletion: boolean;
  EnableContentDeletionFromFolders?: string[];
  EnableContentDownloading: boolean;
}

export interface UserDto {
  Id: string;
  Name: string;
  ServerId?: string;
  Policy?: UserPolicy;
}

export interface AuthenticationResult {
  AccessToken: string;
  ServerId: string;
  User: UserDto;
}

export interface NameId {
  Id: string;
  Name: string;
}

export interface UserItemData {
  IsFavorite?: boolean;
  PlayCount?: number;
  LastPlayedDate?: string;
}

/** A slice of Jellyfin's BaseItemDto. */
export interface BaseItem {
  Id: string;
  Name: string;
  Type: 'Audio' | 'MusicAlbum' | 'MusicArtist' | 'Playlist' | 'MusicGenre' | 'Folder' | string;
  Album?: string;
  AlbumId?: string;
  AlbumArtist?: string;
  AlbumPrimaryImageTag?: string;
  Artists?: string[];
  ArtistItems?: NameId[];
  AlbumArtists?: NameId[];
  ImageTags?: { Primary?: string };
  RunTimeTicks?: number;
  ProductionYear?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ChildCount?: number;
  Container?: string;
  CollectionType?: string;
  SongCount?: number;
  AlbumCount?: number;
  UserData?: UserItemData;
  PlaylistItemId?: string;
}

export interface ItemsResult {
  Items: BaseItem[];
  TotalRecordCount: number;
  StartIndex?: number;
}
