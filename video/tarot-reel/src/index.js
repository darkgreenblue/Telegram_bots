// نقطه‌ی ورودِ Remotion. عمداً فقط یک خط کار می‌کند: هر منطقی که اینجا بنشیند در هر رندر و
// در هر بار باز شدنِ استودیو دوباره اجرا می‌شود و دیباگش سخت‌ترین جای پروژه است.
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root.jsx';

registerRoot(RemotionRoot);
