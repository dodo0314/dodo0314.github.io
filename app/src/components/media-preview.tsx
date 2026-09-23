import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { MediaBlock } from '../core/model';
import { assetUri } from '../services/platform';
import { Loading, Message } from './ui';
function Video({ uri }: {uri: string}) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} nativeControls style={{ width: '100%', height: 240, borderRadius: 12 }} contentFit="contain" />;
}
export function MediaPreview({ block }: {block: MediaBlock}) {
  const [uri, setUri] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { let alive = true; assetUri(block.assetId).then(uri => { if (alive) setUri(uri); }).catch(error => { if (alive) setError(String(error)); }); return () => { alive = false; }; }, [block.assetId]);
  if (error) return <Message message={error} danger />;
  if (!uri) return <View style={{ height: 100 }}><Loading text="첨부파일 준비 중" /></View>;
  return block.type === 'video' ? <Video uri={uri} /> : <Image accessibilityLabel={block.caption || block.name} source={{ uri }} style={{ width: '100%', aspectRatio: Math.max(0.5, Math.min(2, block.width / block.height || 1)), borderRadius: 12 }} resizeMode="contain" />;
}
