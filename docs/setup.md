# 개발 및 배포 설정

## 로컬에서 실행

저장소 루트에서 다음을 실행합니다. Node.js와 npm이 필요합니다.

```sh
cd app
npm ci
npm run web
```

배포 결과를 로컬에서 확인할 때는 `npm run build:pwa` 후 `npm run preview:pwa`를 실행합니다. 미리보기 주소는 `http://localhost:4173`입니다. 테스트와 정적 검사는 `npm test`, `npm run lint`, `npm run typecheck`로 실행합니다. Expo Go를 통한 네이티브 개발은 `npm start`를 사용할 수 있지만, 현재 iPhone 사용 경로는 HTTPS 웹 버전입니다.

## GitHub Pages 배포

저장소 `dodo0314/dodo0314.github.io`의 `main` 브랜치 **루트**를 GitHub Pages 소스로 사용합니다. 공개 주소는 `https://dodo0314.github.io/`입니다. 소스 수정 후 `app/`에서 `npm run build:pwa`를 실행하고, 생성된 `app/dist/`의 **내용**을 저장소 루트에 복사해 커밋합니다. 루트의 `.nojekyll`을 유지하고, 클라이언트 라우팅을 위해 빌드된 `index.html`을 `404.html`에도 복사합니다. 빌드 명령은 서비스 워커·매니페스트·아이콘을 확인하고 버전 정보를 생성합니다. 커밋 전에 루트 실행 파일과 `app/` 원본의 변경을 함께 검토하세요.

앱 데이터는 사이트 주소에 묶이므로 배포 주소를 바꾸면 기존 로컬 기록이 자동 이전되지 않습니다. 새 배포를 확인할 때는 iPhone Chrome 일반 탭과 홈 화면 아이콘을 각각 열어 보세요. 공개 Pages 주소는 누구나 앱 코드를 열 수 있지만 개인 기록을 공개하지 않습니다. 개인 기록이나 백업 ZIP을 이 저장소에 커밋하지 마세요.

## OneDrive 앱 등록

웹 로그인용 Microsoft Entra 앱 등록은 다음 설정을 사용합니다.

| 항목 | 값 |
| --- | --- |
| 애플리케이션(클라이언트) ID | `6e71fe82-edc0-4770-9515-f2d5d31b4f6b` |
| 지원 계정 유형 | 개인 Microsoft 계정 포함 |
| 인증 플랫폼 | 단일 페이지 애플리케이션(SPA) |
| 리디렉션 URI | `https://dodo0314.github.io/` |
| Microsoft Graph 위임 권한 | `Files.ReadWrite.AppFolder` |
| 클라이언트 암호 | 사용하지 않음 |

Entra 관리 센터의 해당 앱에서 **인증 → 플랫폼 추가 → 단일 페이지 애플리케이션**으로 리디렉션 URI를 등록합니다. 끝의 `/`까지 앱 코드의 `window.location.origin + '/'`와 정확히 일치해야 합니다. 예전 `chatgpt.site` 주소만 등록되어 있으면 Microsoft 로그인 화면에서 `redirect_uri` 오류가 납니다. 로컬 개발 주소에서 OneDrive 로그인을 시험하려면 그 주소도 SPA 리디렉션 URI에 별도로 등록해야 합니다. 공개 SPA에 클라이언트 암호를 넣지 마세요.

OneDrive 연결과 백업은 사용자가 실행합니다. 성공 메시지가 표시되어도 OneDrive의 앱 폴더에서 ZIP 파일이 실제 생성되었는지 확인하는 것이 좋습니다. 현재 복원 기능이 없으므로 중요한 기록은 ZIP을 별도로 보관하세요.
