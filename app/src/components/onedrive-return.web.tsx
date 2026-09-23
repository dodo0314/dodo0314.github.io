import { useEffect } from 'react';
import { router } from 'expo-router';
import { clearOneDriveReturn, initializeOneDrive, oneDriveReturnPending } from '../services/onedrive';

export function OneDriveReturn() {
  useEffect(() => {
    void initializeOneDrive().then(() => {
      if (oneDriveReturnPending()) { clearOneDriveReturn(); router.replace('/backup'); }
    }).catch(() => {
      if (oneDriveReturnPending()) { clearOneDriveReturn(); router.replace('/backup'); }
    });
  }, []);
  return null;
}
