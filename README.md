# 모아 (Moa)

글, 사진, 영상을 원하는 순서로 기록하고, AI에 전달할 Markdown 또는 ZIP을 직접 내보내는 개인 기록 앱입니다. [모아 열기](https://dodo0314.github.io/)

이 공개 저장소에는 **앱 코드와 배포 파일만** 있습니다. 작성한 기록과 첨부파일은 사용 중인 브라우저의 IndexedDB에 저장됩니다. 같은 주소에 접속한 다른 사람은 자신의 브라우저 저장소를 사용하며 내 기록을 볼 수 없습니다. 원본 전체 백업을 직접 실행하면 사용자가 연결한 OneDrive에 ZIP이 업로드됩니다. 자동 동기화와 앱 내 복원은 아직 없습니다. 브라우저 데이터를 지우거나 기기를 바꾸기 전에 백업 ZIP을 만들어 실제 저장 여부를 확인하세요.

## 저장소 구조

- 저장소 루트: GitHub Pages에서 바로 제공하는 정적 실행 파일과 PWA 아이콘
- [`app/`](app/): Expo Router 및 React Native Web 기반 원본 소스, 설정, 테스트
- [`docs/architecture.md`](docs/architecture.md): 화면, 저장, 내보내기, 백업의 흐름
- [`docs/setup.md`](docs/setup.md): 로컬 실행, 배포, Microsoft Entra 설정
- [`docs/development.md`](docs/development.md): 개발 과정과 검증 기록

## 개발

Node.js와 npm이 필요합니다.

```sh
cd app
npm ci
npm test
npm run lint
npm run typecheck
npm run build:pwa
npm run preview:pwa
```

로컬 미리보기는 `http://localhost:4173`에서 열립니다. `app/dist/`는 빌드 결과이며 GitHub Pages는 **저장소 루트**의 배포 파일을 제공합니다. 배포 절차는 [설정 안내](docs/setup.md)에 있습니다.

앱의 OneDrive 클라이언트 ID는 공개 앱 식별자입니다. 클라이언트 암호나 사용자 로그인 정보는 저장소에 넣지 않습니다. 사용자의 기록·사진·영상도 커밋하지 않습니다.
