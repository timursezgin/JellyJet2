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
