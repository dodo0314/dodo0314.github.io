# 앱 구성

## 화면과 실행 환경

`app/src/app/`의 Expo Router 화면은 기록 목록(`index.tsx`), 기록 편집(`note/[id].tsx`), AI용 내보내기(`export.tsx`), 원본 전체 백업(`backup.tsx`)으로 구성됩니다. 공통 상태는 `app/src/state/notes.tsx`, UI 컴포넌트는 `app/src/components/`에 있습니다. React Native 앱과 브라우저 앱이 같은 기록 모델과 내보내기 로직을 공유하고, 파일 접근은 플랫폼별 서비스로 나뉩니다.

GitHub Pages의 루트 파일은 Expo 웹 빌드를 정적으로 제공하는 PWA입니다. 서비스 워커(`app/scripts/service-worker.js`)는 앱 실행 파일을 캐시합니다. 기록과 첨부파일은 이 캐시에 들어가지 않습니다. 앱 코드 업데이트는 기록 저장소를 지우지 않지만, 브라우저 저장 데이터를 삭제하면 기록이 사라질 수 있습니다.

## 기록과 첨부파일

기록 모델(`app/src/core/model.ts`)은 제목, 시간, 순서가 있는 텍스트·사진·영상 블록, 첨부 설명, 내보내기 포함 여부를 관리합니다. 웹에서는 `app/src/services/platform.web.ts`가 `moa-local` IndexedDB의 `notes`와 `media` 저장소를 사용합니다. 사진·영상 원본은 `media`에 Blob으로 저장됩니다. iOS 네이티브 구현은 `platform.ts`에 분리되어 있습니다. 변경 저장은 `app/src/core/save-queue.ts`가 순서대로 처리합니다.

브라우저 저장소는 주소의 출처와 브라우저 프로필에 묶입니다. 따라서 Expo Go, 예전 `chatgpt.site` 주소, 현재 GitHub Pages 주소, 다른 사람의 기기는 서로 다른 기록을 봅니다. Chrome 일반 탭과 홈 화면 아이콘의 저장소 공유 여부는 iOS의 실행 방식에 따라 달라질 수 있으므로 각 화면에서 기록이 보이는지 확인해야 합니다. 기기 간 자동 동기화는 없습니다.

## AI용 내보내기

`app/src/core/export.ts`가 선택한 기록을 블록 순서대로 Markdown으로 만들고, `platform.web.ts` 또는 `platform.ts`가 첨부파일을 처리합니다. 사진이 있으면 크기를 조정한 JPEG 사본을 만들 수 있습니다. 영상이 있으면 지정한 장수의 대표 장면을 JPEG로 추출할 수 있습니다. 사진·영상 원본은 AI용 ZIP에 넣을지 각각 선택합니다. 포함된 첨부가 없으면 미디어 옵션을 표시하지 않고 MD만 제공합니다. ZIP의 압축 자체가 AI 토큰 사용량을 줄이지는 않으며, 이미지 크기와 장면 수를 조절하는 것이 중요합니다. 영상의 소리·전체 움직임을 분석하거나 음성을 전사하지 않습니다.

## 원본 백업과 OneDrive

원본 전체 백업은 모든 기록의 메타데이터·블록 순서를 `backup.json`에, 사진·영상 원본을 `media/`에 담은 ZIP입니다. AI용 내보내기에서 제외한 첨부도 백업에는 포함됩니다. 백업은 사용자가 직접 내려받거나 OneDrive에 업로드할 수 있습니다. 현재 앱에는 백업 ZIP을 다시 불러오는 복원 화면이 없습니다.

웹 OneDrive 인증은 `app/src/services/onedrive.web.ts`의 MSAL Browser가 Microsoft 개인 계정용 `consumers` 엔드포인트와 `Files.ReadWrite.AppFolder` 위임 권한을 사용합니다. `app/src/services/onedrive-upload.ts`는 Microsoft Graph를 통해 앱 폴더에 백업 ZIP을 업로드하며 큰 파일에는 업로드 세션을 사용합니다. 로그인 토큰은 MSAL의 브라우저 로컬 저장소에서 관리됩니다. 앱에는 클라이언트 암호가 없고, 백업은 사용자가 시작할 때만 전송됩니다.
