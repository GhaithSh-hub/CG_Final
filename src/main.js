import * as THREE from 'three';
// ⚠️ خارج قائمة المفاهيم الأصلية؛ مفعّل بطلب صريح لاستبدال المكعبات بنماذج حقيقية
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';


const CONFIG = {
  // --- مقاسات الطريق ---
  roadWidth: 20,
  roadLength: 400,
  roadThickness: 0.4,//سماكة الطريق
  roadCenterZ: -180, // مركز الطريق للخلف حتى يمتدّ من خلف الكاميرا إلى الأفق
  wallWidth: 0.6,
  wallHeight: 1.2,
  grassSize: 700,
  laneLineGap: 12, // المسافة بين بداية خط وبداية الذي يليه

  // --- حدود المنطقة الحيّة ---
  spawnZ: -150, // مكان ولادة كل جديد
  despawnZ: 15, // خلف الكاميرا → يُحذف فوراً

  // --- قيم البداية (تُقرأ عند التحميل وعند إعادة التشغيل) ---
  worldSpeedStart: 34, // وحدة/ثانية
  spawnIntervalStart: 1200, // مللي ثانية
  driftChanceStart: 0.2, // احتمال أن يكون الحاجز متأرجحاً
  startTime: 30, // ثانية

  // --- اللاعب والكاميرا ---
  steerSpeed: 20, // سرعة تغيّر الهدف targetX بالوحدة/ثانية
  maxTilt: 0.3, // أقصى ميلان للهيكل بالراديان

  // --- مسارات نماذج GLTF (خارج القائمة الأصلية، بطلب صريح) ---
  // الملفات تُقرأ من public/models/ فتُخدَّم من جذر الموقع بهذه المسارات مباشرة
  modelPaths: {
    car: '/models/car.glb',
    obstacleStatic: '/models/obstacle-static.glb',
    obstacleDrift: '/models/obstacle-drift.glb',
    barrel: '/models/barrel.glb',
  },
  // ملفات GLTF قد تُصدَّر بوحدة قياس مختلفة تماماً (سنتيمتر بدل متر مثلاً)، فحجمها
  // الخام في المشهد قد يكون أضعافاً مضاعفة للمطلوب. لكل نموذج نحدّد أطول ضلع
  // مستهدف بوحدات اللعبة؛ يُعاد تحجيم النموذج تلقائياً وقت التحميل ليطابقه.
  modelTargetSize: {
    car: 4.2, // طول سيارة صغيرة تقريباً
    obstacleStatic: 3.0,
    obstacleDrift: 2.0,
    barrel: 1.3, // ارتفاع برميل نمطي
  },
  // "مقدّمة" النموذج قد لا تُصدَّر مطابقة لاتجاه -Z الذي تفترضه اللعبة (حيث تأتي
  // الحواجز)؛ Math.PI يعكس السيارة 180° حول المحور الرأسي. عدّله إن بدت السيارة
  // تسير للخلف (0 أو Math.PI) أو جانبياً (±Math.PI / 2) حسب اتجاه ملفك الفعلي.
  carModelYawOffset: Math.PI,

  // بعض ملفات GLTF تُصدَّر بمحور "أعلى" مختلف عن Y (Z-up مثلاً)، فيظهر النموذج
  // مستلقياً على جنبه بدل واقف على قاعدته. Math.PI/2 حول X تجربة أولى؛ إن ظهر
  // النموذج مقلوباً أو مستلقياً على جهة مختلفة جرّب -Math.PI/2 أو 0.
  obstacleDriftRotationOffset: { x:Math.PI / 2, y: Math.PI / 2, z: Math.PI / 2 },
};

// 1. الإعداد — المشهد والكاميرا والمُصيّر


const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // لون السماء 

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);

camera.position.set(0, 4, 8.5); 
camera.lookAt(0, 1.2, -12);


const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // سقف للأداء على الشاشات عالية الكثافة
renderer.shadowMap.enabled = true; // تفعيل مرحلة رسم خريطة الظل (تمريرة إضافية من منظور الضوء)
// renderer.shadowMap.type = THREE.PCFSoftShadowMap; // تنعيم حواف الظل بأخذ عيّنات متعددة
document.body.appendChild(renderer.domElement);


// 2. الإضاءة — ضوء محيطي + شمس اتجاهية ترمي الظلال

// الضوء المحيطي يمنع سواد الأوجه غير المواجهة للشمس (لا يرمي ظلاً)
const ambientLight = new THREE.AmbientLight(0xffffff, 2);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(15, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(8192, 8192); // دقّة خريطة الظل ≈ حجم الـ FBO
// الضوء الاتجاهي يستخدم إسقاطاً متعامداً؛ هذه حدود صندوق العرض من منظور الشمس
dirLight.shadow.camera.left = -40;
dirLight.shadow.camera.right = 40;
dirLight.shadow.camera.top = 40;
dirLight.shadow.camera.bottom = -40;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 120;
dirLight.shadow.bias = -0.0005; // يزيح عمق العيّنة قليلاً لمنع تشوّه Shadow Acne
scene.add(dirLight);

// 3. العالم — الأرضية والطريق والحواجز الجانبية وخطوط المنتصف

const roadHalfWidth = CONFIG.roadWidth / 2;

// أرضية العشب: تستقبل الظل فقط (لا شيء تحتها لترميه عليه)
const grassGeometry = new THREE.BoxGeometry(CONFIG.grassSize, 0.4, CONFIG.grassSize);//x y z ,  حجم العشب
const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x3f8a3a, roughness: 1 });
const grass = new THREE.Mesh(grassGeometry, grassMaterial);
grass.position.set(0, -0.35, CONFIG.roadCenterZ); //  تعريف مكان العشب _____ أخفض قليلاً من الطريق _____ دفعها للأمام (العمق)
grass.receiveShadow = true; // الأرضية تتلقى الظلال
scene.add(grass);

// الطريق: سطحه العلوي عند y = 0 بالضبط ليكون مرجع ارتفاع كل شيء
const roadGeometry = new THREE.BoxGeometry(CONFIG.roadWidth, CONFIG.roadThickness, CONFIG.roadLength);//200 0.4 400
const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x33363d, roughness: 0.95 });
const road = new THREE.Mesh(roadGeometry, roadMaterial);
road.position.set(0, -CONFIG.roadThickness / 2, CONFIG.roadCenterZ);//تعريف مكان الطريق
road.receiveShadow = true;
scene.add(road);


// الحاجزان الجانبيان: يرميان ظلاً على الطريق ويحدّدان حوافه بصرياً
const wallGeometry = new THREE.BoxGeometry(CONFIG.wallWidth, CONFIG.wallHeight, CONFIG.roadLength);//0.6 , 1.2 , 400
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xb8bec9, roughness: 0.7 });
const leftWall = new THREE.Mesh(wallGeometry, wallMaterial);
//الرصيف الايسر
leftWall.position.set(-roadHalfWidth - CONFIG.wallWidth / 2, CONFIG.wallHeight / 2, CONFIG.roadCenterZ);// هذه التعريفات هي مركز الرسم, فعند رسم الاكسات 0.6 تكون 0.3 من الايمن و 0.3 من الايسر
leftWall.castShadow = true;
leftWall.receiveShadow = true;
scene.add(leftWall);
//الرصيف الايمن
const rightWall = new THREE.Mesh(wallGeometry, wallMaterial);
rightWall.position.set(roadHalfWidth + CONFIG.wallWidth / 2, CONFIG.wallHeight / 2, CONFIG.roadCenterZ);
rightWall.castShadow = true;
rightWall.receiveShadow = true;
scene.add(rightWall);


// خطوط المنتصف المتقطّعة: عددها ثابت وتُعاد دورتها بدل توليد خطوط جديدة
const laneLines = [];
const laneLineCount = Math.floor(CONFIG.roadLength / CONFIG.laneLineGap);//عدد الخطوط البيضاء
const laneLineSpan = laneLineCount * CONFIG.laneLineGap; // طول الدورة الكاملة
// هندسة وخامة واحدة مشتركة بين كل الخطوط 
const laneLineGeometry = new THREE.BoxGeometry(0.35, 0.04, 6);
const laneLineMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });

for (let i = 0; i < laneLineCount; i++) {
  const line = new THREE.Mesh(laneLineGeometry, laneLineMaterial);
  // y فوق سطح الطريق بشعرة لتفادي تداخل العمق (Z-fighting)
  line.position.set(0, 0.02, CONFIG.despawnZ - i * CONFIG.laneLineGap);
  line.receiveShadow = true;
  scene.add(line);
  laneLines.push(line);
}

// 4. اللاعب — حاوية فارغة تُملأ بنموذج GLTF فور اكتمال تحميله (القسم 5.5)
// نُبقيها فارغة الآن بدل انتظار الشبكة هنا: car.position/car.rotation تعمل من
// الإطار الأول رغم أنّ محتواها المرئي يظهر لاحقاً بعد نجاح التحميل غير المتزامن.
const car = new THREE.Group();
scene.add(car);

// الموضع الأفقي المستهدف؛ السيارة تلاحقه بنعومة عبر lerp
let targetX = 0;
const steerLimit = roadHalfWidth - 1.15; // 1.15 تقدير مبدئي؛ عدّله إن اختلف عرض نموذجك الفعلي

// 5. حالة اللعبة والمصفوفات الحيّة

// LOADING تمنع بدء اللعبة قبل اكتمال تحميل النماذج (انظر القسم 5.5)
const GAME_STATE = { LOADING: 'loading', READY: 'ready', PLAYING: 'playing', OVER: 'over' };
let gameState = GAME_STATE.LOADING;

const obstacles = []; // كل عنصر Mesh يحمل خصائص إضافية: ownSpeed / driftDirection
const barrels = [];

let worldSpeed = CONFIG.worldSpeedStart;
let spawnInterval = CONFIG.spawnIntervalStart / 1000; // نعمل بالثواني داخلياً
let driftChance = CONFIG.driftChanceStart;
let spawnTimer = 0;
let difficultyTimer = 0;
let spawnedObstacleCount = 0;

let score = 0;
let bestScore = 0; // متغيّر داخل الصفحة فقط (بدون localStorage)
let timeLeft = CONFIG.startTime;

// كائنات تُنشأ مرة واحدة هنا ويُعاد استعمالها كل إطار — ممنوع إنشاء أي منها داخل animate()
const playerBox = new THREE.Box3();
const scratchBox = new THREE.Box3();

// 5.5 تحميل نماذج GLTF الحقيقية — يستبدل BoxGeometry/CylinderGeometry بطلب صريح
// ⚠️ GLTFLoader والتحميل غير المتزامن (Promise) خارج قائمة المفاهيم الأصلية.
// نماذج الحواجز والبرميل تُحمَّل كقوالب مرّة واحدة ولا تُضاف للمشهد مباشرة؛ كل
// حاجز/برميل يُولَد لاحقاً كنسخة (clone) من قالبه، تشارك الهندسة والخامة بالمرجع
// لا بنسخ فعلي — هذا يغيّر منطق التنظيف في القسم 10 (راجع التعليق هناك).
const gltfLoader = new GLTFLoader();
let obstacleStaticTemplate = null;
let obstacleDriftTemplate = null;
let barrelTemplate = null;

const loadingStatusElement = document.getElementById('loading-status');
const readyPromptElement = document.getElementById('ready-prompt');

/**
 * يستنسخ النموذج، يُطبِّع حجمه تلقائياً بدل الاعتماد على مقياس الملف الخام،
 * ثم يفعّل الظل على كل أبنائه (لا وراثة تلقائية لهذه الرايات).
 * القياس هنا بعد التحميل الكامل عبر three.js فيشمل أي تحجيم مضمَّن داخل عقد
 * الملف نفسه — على عكس قراءة أبعاد الهندسة الخام مباشرة من ملف GLB.
 *
 * نُعيد "حاوية" (Group) فارغة تحتوي النموذج بعد إزاحته أفقياً، لا النموذج
 * نفسه: نقطة أصل ملف GLTF (pivot) نادراً ما تقع في مركز صندوق إحاطته —
 * فلو حرّكنا النموذج مباشرة بافتراض أنّ position يمثّل مركزه، لظهر جزء منه
 * خارج الحد المقصود (هذا بالضبط سبب خروج الحاجز المتأرجح عن حافّة الطريق).
 * الحاوية تجعل position.x/z يمثّلان مركز المجسّم الحقيقي بصرف النظر عن pivot الملف.
 */
function attachModelClone(group, template, targetLongestSide) {
  const model = template.clone(true);

  const rawBounds = new THREE.Box3().setFromObject(model);
  const rawSize = Math.max(
    rawBounds.max.x - rawBounds.min.x,
    rawBounds.max.y - rawBounds.min.y,
    rawBounds.max.z - rawBounds.min.z
  );
  if (rawSize > 0) model.scale.setScalar(targetLongestSide / rawSize);

  // نزيح النموذج داخل حاويته حتى يقع مركز صندوق إحاطته أفقياً عند أصل الحاوية
  const centeredBounds = new THREE.Box3().setFromObject(model);
  model.position.x -= (centeredBounds.min.x + centeredBounds.max.x) / 2;
  model.position.z -= (centeredBounds.min.z + centeredBounds.max.z) / 2;

  const container = new THREE.Group();
  container.add(model);

  container.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  group.add(container);
  return container;
}

Promise.all([
  gltfLoader.loadAsync(CONFIG.modelPaths.car),
  gltfLoader.loadAsync(CONFIG.modelPaths.obstacleStatic),
  gltfLoader.loadAsync(CONFIG.modelPaths.obstacleDrift),
  gltfLoader.loadAsync(CONFIG.modelPaths.barrel),
])
  .then(([carGltf, staticGltf, driftGltf, barrelGltf]) => {
    // يملأ حاوية السيارة الفارغة بالنموذج الحقيقي، ثم يرفعه حتى تلامس عجلاته y=0
    const carModel = attachModelClone(car, carGltf.scene, CONFIG.modelTargetSize.car);
    carModel.rotation.y = CONFIG.carModelYawOffset; // تصحيح اتجاه "المقدّمة" نحو -Z
    const carBounds = new THREE.Box3().setFromObject(carModel);
    carModel.position.y -= carBounds.min.y;

    obstacleStaticTemplate = staticGltf.scene;
    obstacleDriftTemplate = driftGltf.scene;
    barrelTemplate = barrelGltf.scene;

    loadingStatusElement.style.display = 'none';
    readyPromptElement.style.display = '';
    gameState = GAME_STATE.READY; // يسمح ببدء اللعبة الآن فقط
  })
  .catch((error) => {
    console.error('فشل تحميل نماذج GLTF:', error);
    loadingStatusElement.textContent =
      'تعذّر تحميل النماذج — تأكد من وضع الملفات في public/models/ بالأسماء المتوقّعة.';
  });

// 6. التوليد — الحواجز وبراميل الوقود

/** رقم عشوائي ضمن مجال. */
function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * يولّد حاجزاً كنسخة من قالب GLTF محمَّل مسبقاً (ثابت أو متأرجح).
 * الأبعاد تُقاس من صندوق الإحاطة الفعلي للنموذج (لا أرقام مفترضة) لأن حجم
 * ومحور أصل النموذج الحقيقي غير معروفين مسبقاً — يعتمدان على الملف الذي تختاره.
 */
function spawnObstacle() {
  const isDrifting = Math.random() < driftChance;
  const template = isDrifting ? obstacleDriftTemplate : obstacleStaticTemplate;
  const targetSize = isDrifting
    ? CONFIG.modelTargetSize.obstacleDrift
    : CONFIG.modelTargetSize.obstacleStatic;
  const obstacle = attachModelClone(scene, template, targetSize);

  // تصحيح وقوف النموذج المتأرجح إن كان مُصدَّراً مستلقياً على جنبه (راجع CONFIG)؛
  // يُطبَّق قبل قياس الصندوق حتى تعكس الأبعاد الشكل بعد التصحيح لا قبله
  if (isDrifting) {
    const rotation = CONFIG.obstacleDriftRotationOffset;
    obstacle.rotation.set(rotation.x, rotation.y, rotation.z);
  }

  const bounds = new THREE.Box3().setFromObject(obstacle);
  const halfWidth = (bounds.max.x - bounds.min.x) / 2;
  const groundOffset = -bounds.min.y; // يرفع النموذج حتى تلامس قاعدته الفعلية سطح الطريق

  const limit = roadHalfWidth - halfWidth;
  obstacle.position.set(randomRange(-limit, limit), groundOffset, CONFIG.spawnZ);

  // خصائص خاصة باللعبة نعلّقها على المجسّم مباشرة
  obstacle.ownSpeed = randomRange(0.8, 1.4); // معامل يُضرب في سرعة العالم
  obstacle.halfWidth = halfWidth;
  obstacle.driftDirection = isDrifting ? (Math.random() < 0.5 ? -1 : 1) : 0;

  obstacles.push(obstacle);
  return obstacle.position.x;
}

/** برميل وقود مستنسخ من قالب GLTF؛ يُوضع بعيداً عن الحاجز الأخير أفقياً ليبقى قابلاً للجمع. */
function spawnBarrel(lastObstacleX) {
  const barrel = attachModelClone(scene, barrelTemplate, CONFIG.modelTargetSize.barrel);

  const bounds = new THREE.Box3().setFromObject(barrel);
  const groundOffset = -bounds.min.y;

  // نبتعد عن الحاجز الأخير بمقدار كافٍ ثم نقيّد النتيجة داخل الطريق
  const awayDirection = lastObstacleX > 0 ? -1 : 1;
  const barrelX = THREE.MathUtils.clamp(
    lastObstacleX + awayDirection * randomRange(4, 8),
    -roadHalfWidth + 1,
    roadHalfWidth - 1
  );

  barrel.position.set(barrelX, groundOffset, CONFIG.spawnZ - 8);
  barrel.rotation.z = 0.28; // ميلان ثابت يجعل الدوران حول Y مرئياً
  barrel.ownSpeed = 1;

  barrels.push(barrel);
}

/** مؤقّت التوليد: يعمل بالتراكم الزمني لا بـ setInterval حتى يتوقّف تلقائياً مع توقّف الحلقة. */
function updateSpawner(delta) {
  spawnTimer += delta;
  if (spawnTimer < spawnInterval) return;

  spawnTimer = 0;
  const lastObstacleX = spawnObstacle();
  spawnedObstacleCount++;

  // برميل واحد لكل أربعة حواجز
  if (spawnedObstacleCount % 4 === 0) {
    spawnBarrel(lastObstacleX);
  }
}

/** التدرّج في الصعوبة كل 15 ثانية: أسرع، وتوليد أكثف، وتأرجح أكثر. */
function updateDifficulty(delta) {
  difficultyTimer += delta;
  if (difficultyTimer < 15) return;

  difficultyTimer = 0;
  worldSpeed = Math.min(worldSpeed * 1.08, 95); // +8% حتى سقف السرعة
  spawnInterval = Math.max(spawnInterval - 150 / 1000, 450 / 1000); // نزولاً حتى 450ms
  driftChance = Math.min(driftChance + 0.12, 0.75);
}

// 7. المدخلات — لوحة المفاتيح

const keys = { left: false, right: false };

window.addEventListener('keydown', (event) => {
  // منع الأسهم والمسافة من تمرير الصفحة
  if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();

  // event.code يقرأ المفتاح الفيزيائي فلا يتأثر بلغة لوحة المفاتيح
  if (event.code === 'ArrowLeft') keys.left = true;
  if (event.code === 'ArrowRight') keys.right = true;

  if (gameState === GAME_STATE.READY) {
    startGame();
  } else if (gameState === GAME_STATE.OVER && event.code === 'Space') {
    restartGame();
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'ArrowLeft') keys.left = false;
  if (event.code === 'ArrowRight') keys.right = false;
});

// تحديث نسبة العرض إلى الارتفاع ومنفذ الرسم عند تغيّر حجم النافذة ≈ glViewport
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix(); // إعادة بناء مصفوفة الإسقاط
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// 8. التحديث — اللاعب والعالم والكاميرا

/**
 * معامل lerp مستقلّ عن معدّل الإطارات.
 * المعامل الثابت (0.12 مثلاً) مصمّم لإطار 60Hz؛ نحوّله أُسّياً لزمن الإطار الفعلي
 * حتى يبقى الإحساس نفسه على 60Hz و 144Hz.
 */
function frameLerpFactor(baseFactor, delta) {
  return 1 - Math.pow(1 - baseFactor, delta * 60);
}

function updatePlayer(delta) {
  if (keys.left) targetX -= CONFIG.steerSpeed * delta;
  if (keys.right) targetX += CONFIG.steerSpeed * delta;
  targetX = THREE.MathUtils.clamp(targetX, -steerLimit, steerLimit);

  // ملاحقة ناعمة للهدف بدل النقل الفوري
  car.position.x = THREE.MathUtils.lerp(car.position.x, targetX, frameLerpFactor(0.12, delta));

  // الميلان يتناسب عكسياً مع الفرق المتبقّي: كلما زاد الفرق زاد انحناء الهيكل
  const steerDifference = targetX - car.position.x;
  const targetTilt = THREE.MathUtils.clamp(
    -steerDifference * 0.16,
    -CONFIG.maxTilt,
    CONFIG.maxTilt
  );
  car.rotation.z = THREE.MathUtils.lerp(car.rotation.z, targetTilt, frameLerpFactor(0.1, delta));
}

function updateCamera(delta) {
  camera.position.x = THREE.MathUtils.lerp(
    camera.position.x,
    car.position.x,
    frameLerpFactor(0.05, delta) // أبطأ من السيارة (0.12) → تأخّر يعطي إحساس السرعة
  );
  // نقطة النظر تتبع نصف انزياح السيارة فقط حتى لا يدور المشهد كله معها
  camera.lookAt(car.position.x * 0.5, 1.2, -12);
}

/** الخطوط المتقطّعة تزحف مع العالم وتُعاد للخلف عند تجاوزها الكاميرا. */
function updateLaneLines(delta) {
  const step = worldSpeed * delta;
  for (let i = 0; i < laneLines.length; i++) {
    const line = laneLines[i];
    line.position.z += step;
    if (line.position.z > CONFIG.despawnZ) {
      line.position.z -= laneLineSpan; // دورة لانهائية بلا تخصيص ذاكرة جديد
    }
  }
}

/** تحريك الحواجز + تأرجحها + حذف ما تجاوز الكاميرا. */
function updateObstacles(delta) {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obstacle = obstacles[i];
    obstacle.position.z += worldSpeed * obstacle.ownSpeed * delta;

    // الحواجز المتأرجحة: تنعكس عند بلوغ حدّ الطريق
    if (obstacle.driftDirection !== 0) {
      obstacle.position.x += obstacle.driftDirection * 3.0 * delta; // 3 وحدات/ثانية
      const limit = roadHalfWidth - obstacle.halfWidth;
      if (obstacle.position.x > limit) {
        obstacle.position.x = limit;
        obstacle.driftDirection = -1;
      } else if (obstacle.position.x < -limit) {
        obstacle.position.x = -limit;
        obstacle.driftDirection = 1;
      }
    }

    if (obstacle.position.z > CONFIG.despawnZ) {
      removeFromScene(obstacle, obstacles, i);
    }
  }
}

/** تحريك البراميل + دورانها + حذف ما تجاوز الكاميرا. */
function updateBarrels(delta) {
  for (let i = barrels.length - 1; i >= 0; i--) {
    const barrel = barrels[i];
    barrel.position.z += worldSpeed * barrel.ownSpeed * delta;
    barrel.rotation.y += 2.6 * delta; // راديان/ثانية — دوران يلفت النظر

    if (barrel.position.z > CONFIG.despawnZ) {
      removeFromScene(barrel, barrels, i);
    }
  }
}

// 9. التصادم — AABB عبر THREE.Box3 حصراً

function checkCollisions() {
  // صندوق اللاعب يُحدَّث في مكانه (بلا تخصيص) من مجموعة السيارة
  playerBox.setFromObject(car);
  // العجلات توسّع الصندوق أكثر من اللازم فيشعر اللاعب أنه اصطدم بالهواء

  playerBox.expandByScalar(-0.15);

  // الحواجز: أول تقاطع ينهي الجولة
  for (let i = obstacles.length - 1; i >= 0; i--) {
    scratchBox.setFromObject(obstacles[i]);
    if (playerBox.intersectsBox(scratchBox)) {
      endGame('crash');
      return;
    }
  }

  // البراميل: التقاط ثم حذف فوري
  for (let i = barrels.length - 1; i >= 0; i--) {
    scratchBox.setFromObject(barrels[i]);
    if (playerBox.intersectsBox(scratchBox)) {
      timeLeft += 5; // ثوانٍ إضافية للعدّاد
      score += 50;
      removeFromScene(barrels[i], barrels, i);
    }
  }
}

// 10. التنظيف — إزالة من المشهد بلا كسر القوالب المشتركة
// كل حاجز/برميل الآن نسخة (clone) من قالب GLTF واحد؛ الاستنساخ في three.js
// يُشارك الهندسة والخامة بالمرجع لا بنسخ فعلي. فاستدعاء dispose() هنا كما كان
// سابقاً مع BoxGeometry المستقلّة سيُتلف مورداً ما زالت نسخ أخرى من نفس القالب
// تُعرَض به. لذا: إزالة من المشهد وإزالة من المصفوفة فقط؛ القوالب المشتركة
// تُحرَّر مرّة واحدة عند إغلاق الصفحة (أسفل)، لا عند حذف كل نسخة على حدة.
function removeFromScene(object, array, index) {
  scene.remove(object);
  array.splice(index, 1);
}

/** تفريغ كامل لكل ما وُلّد في الجولة — المرور عكسياً حتى لا يفسد splice الفهرسة. */
function clearSpawnedObjects() {
  for (let i = obstacles.length - 1; i >= 0; i--) {
    removeFromScene(obstacles[i], obstacles, i);
  }
  for (let i = barrels.length - 1; i >= 0; i--) {
    removeFromScene(barrels[i], barrels, i);
  }
}

/** يعادل glDeleteBuffers/glDeleteProgram لكل هندسة وخامة تحت هذا الجذر. */
function disposeTemplate(root) {
  if (!root) return;
  root.traverse((child) => {
    if (!child.isMesh) return;
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });
}

// القوالب تبقى محمَّلة طوال الجلسة لإعادة الاستنساخ منها؛ تُحرَّر مرّة واحدة فقط
// عند إغلاق الصفحة — لا حاجة لإعادة تحميلها بين الجولات المتكرّرة (restartGame)
window.addEventListener('beforeunload', () => {
  disposeTemplate(car); // يحرّر نسخة نموذج السيارة الوحيدة المُستخدَمة فعلياً
  disposeTemplate(obstacleStaticTemplate);
  disposeTemplate(obstacleDriftTemplate);
  disposeTemplate(barrelTemplate);
});

// 11. الواجهة — تحديث عناصر HTML فوق الـ canvas

const scoreElement = document.getElementById('score-value');
const bestElement = document.getElementById('best-value');
const timeElement = document.getElementById('time-value');
const timeBarElement = document.getElementById('time-bar-fill');
const startScreen = document.getElementById('start-screen');
const endScreen = document.getElementById('end-screen');
const endReasonElement = document.getElementById('end-reason');
const finalScoreElement = document.getElementById('final-score');
const finalBestElement = document.getElementById('final-best');

function updateHUD() {
  const clampedTime = Math.max(timeLeft, 0);

  scoreElement.textContent = Math.floor(score);
  bestElement.textContent = Math.floor(bestScore);
  timeElement.textContent = clampedTime.toFixed(1);
  // 40 = أقصى امتلاء للشريط، لأن الوقت قد يتجاوز الـ 30 بجمع البراميل
  timeBarElement.style.width = THREE.MathUtils.clamp(clampedTime / 40, 0, 1) * 100 + '%';

  // أحمر ووميض تحت 5 ثوانٍ، برتقالي تحت 10
  let timeClass = '';
  if (clampedTime <= 5) timeClass = 'danger';
  else if (clampedTime <= 10) timeClass = 'warn';
  timeElement.className = 'hud-value ' + timeClass;
  timeBarElement.className = timeClass;
}

// 12. دورة حياة اللعبة — البدء والنهاية وإعادة التشغيل

function startGame() {
  gameState = GAME_STATE.PLAYING;
  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  lastFrameTime = performance.now(); // تصفير زمن الإطار حتى لا يقفز delta عند البدء
}

function endGame(reason) {
  gameState = GAME_STATE.OVER;
  if (score > bestScore) bestScore = score;

  endReasonElement.textContent = reason === 'fuel' ? '⛽ نفد الوقود!' : '💥 اصطدام!';
  finalScoreElement.textContent = Math.floor(score);
  finalBestElement.textContent = Math.floor(bestScore);
  endScreen.classList.remove('hidden');
}

/** إعادة ضبط كاملة: لا يبقى أي مجسّم أو متغيّر من الجولة السابقة. */
function restartGame() {
  clearSpawnedObjects();

  worldSpeed = CONFIG.worldSpeedStart;
  spawnInterval = CONFIG.spawnIntervalStart / 1000;
  driftChance = CONFIG.driftChanceStart;
  spawnTimer = 0;
  difficultyTimer = 0;
  spawnedObstacleCount = 0;

  score = 0;
  timeLeft = CONFIG.startTime;

  targetX = 0;
  car.position.x = 0;
  car.rotation.z = 0;
  camera.position.x = 0;
  keys.left = false;
  keys.right = false;

  updateHUD();
  startGame();
}

// 13. الحلقة الرئيسية

let lastFrameTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  // زمن الإطار الحقيقي بالثواني، بسقف 0.05 يمنع القفزات بعد العودة من تبويب آخر
  const now = performance.now();
  let delta = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  delta = Math.min(delta, 0.05);

  // في حالتي البداية والنهاية نستمر بالرسم فقط ونوقف كل التحديثات
  if (gameState === GAME_STATE.PLAYING) {
    updatePlayer(delta);
    updateCamera(delta);
    updateLaneLines(delta);
    updateSpawner(delta);
    updateObstacles(delta);
    updateBarrels(delta);
    checkCollisions();
  }

  // التحقق ثانيةً: قد يكون checkCollisions قد أنهى الجولة في هذا الإطار نفسه
  if (gameState === GAME_STATE.PLAYING) {
    // النقاط تنمو مع المسافة المقطوعة فعلياً، والوقت يتناقص باستمرار
    score += worldSpeed * delta;
    timeLeft -= delta;
    if (timeLeft <= 0) {
      timeLeft = 0;
      endGame('fuel');
    }

    updateDifficulty(delta);
    updateHUD();
  }

  renderer.render(scene, camera); // تمريرة الرسم ≈ glDrawElements لكل مجسّم
}

updateHUD();
animate();
