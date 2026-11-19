"""Train the plate detector on generate.mjs's pictures and export it for the browser (ONNX).

    python scripts/plate-detector/train.py --data data --epochs 30 --out plate-detector.onnx

A small CenterNet-style network (Zhou et al., "Objects as Points"), written here from scratch: for every
plate, a peak at its centre in a 64 x 64 heatmap (1/4 of the 256 x 256 grey input), and at that cell the
centre's sub-cell offset, the outline's half-axes (log, in cells) and its tilt (cos 2phi, sin 2phi, so a
half turn is the same outline). Output: [1, 7, 64, 64] = heat (sigmoid), dx, dy, log a, log b, cos 2phi,
sin 2phi. The app refines each found outline on the plate's own edge (plate3d.js fitRim), so the network
only has to be roughly right and never miss.
Input: grey frame letterboxed to 256 x 256, (v / 255 - 0.5) / 0.25.
"""
import argparse, glob, json, math, os, time
import numpy as np
import torch, torch.nn as nn, torch.nn.functional as F

S, STRIDE = 256, 4
H = S // STRIDE

def load(data):
    imgs, labels = [], []
    for j in sorted(glob.glob(os.path.join(data, '*.json'))):
        meta = json.load(open(j))
        b = np.fromfile(j[:-5] + '.bin', dtype=np.uint8).reshape(meta['n'], meta['size'], meta['size'])
        imgs.append(b); labels += meta['labels']
    return np.concatenate(imgs), labels

def targets(labels, flip):
    """Heatmap (gaussian per plate, radius from its size) and the regression targets at each centre cell."""
    heat = np.zeros((H, H), np.float32); reg = np.zeros((6, H, H), np.float32); mask = np.zeros((H, H), np.float32)
    for l in labels:
        cx, cy, a, b, phi = l['cx'], l['cy'], l['a'], l['b'], l['phi']
        if flip: cx, phi = S - cx, -phi
        gx, gy = cx / STRIDE, cy / STRIDE
        ix, iy = int(gx), int(gy)
        if not (0 <= ix < H and 0 <= iy < H): continue
        sig = max(0.7, 0.15 * b / STRIDE)
        r = int(3 * sig) + 1
        ys, xs = np.mgrid[max(0, iy - r):min(H, iy + r + 1), max(0, ix - r):min(H, ix + r + 1)]
        g = np.exp(-((xs - ix) ** 2 + (ys - iy) ** 2) / (2 * sig * sig))
        heat[ys, xs] = np.maximum(heat[ys, xs], g)
        reg[:, iy, ix] = [gx - ix, gy - iy, math.log(a / STRIDE), math.log(b / STRIDE), math.cos(2 * phi), math.sin(2 * phi)]
        mask[iy, ix] = min(1.0, 4 * (1 - b / a)) + 1e-3  # the tilt only matters for a squashed outline (stored in mask's fraction)
    return heat, reg, mask

class Plates(torch.utils.data.Dataset):
    def __init__(self, imgs, labels, train): self.imgs, self.labels, self.train = imgs, labels, train
    def __len__(self): return len(self.imgs)
    def __getitem__(self, i):
        img = self.imgs[i].astype(np.float32)
        flip = self.train and np.random.rand() < 0.5
        if flip: img = img[:, ::-1].copy()
        if self.train:  # a little more light / contrast variety on top of the generator's
            img = np.clip(img * np.random.uniform(0.8, 1.2) + np.random.uniform(-20, 20), 0, 255)
        heat, reg, mask = targets(self.labels[i], flip)
        x = (img / 255.0 - 0.5) / 0.25
        return torch.from_numpy(x[None]), torch.from_numpy(heat[None]), torch.from_numpy(reg), torch.from_numpy(mask[None])

def cbr(i, o, s): return nn.Sequential(nn.Conv2d(i, o, 3, s, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.s1 = nn.Sequential(cbr(1, 16, 2), cbr(16, 16, 1))                       # 1/2
        self.s2 = nn.Sequential(cbr(16, 32, 2), cbr(32, 32, 1))                      # 1/4
        self.s3 = nn.Sequential(cbr(32, 64, 2), cbr(64, 64, 1))                      # 1/8
        self.s4 = nn.Sequential(cbr(64, 96, 2), cbr(96, 96, 1), cbr(96, 96, 1))      # 1/16
        self.s5 = nn.Sequential(cbr(96, 128, 2), cbr(128, 128, 1), cbr(128, 128, 1)) # 1/32 (sees a whole big plate)
        self.l2, self.l3, self.l4, self.l5 = nn.Conv2d(32, 64, 1), nn.Conv2d(64, 64, 1), nn.Conv2d(96, 64, 1), nn.Conv2d(128, 64, 1)
        self.head = nn.Sequential(cbr(64, 64, 1), cbr(64, 64, 1), nn.Conv2d(64, 7, 1))
        nn.init.constant_(self.head[-1].bias, 0); self.head[-1].bias.data[0] = -2.19  # heat starts near 0.1
    def forward(self, x):
        c2 = self.s2(self.s1(x)); c3 = self.s3(c2); c4 = self.s4(c3); c5 = self.s5(c4)
        up = lambda t: F.interpolate(t, scale_factor=2, mode='nearest')
        p = self.l5(c5); p = self.l4(c4) + up(p); p = self.l3(c3) + up(p); p = self.l2(c2) + up(p)
        o = self.head(p)
        return torch.cat([torch.sigmoid(o[:, :1]), o[:, 1:]], 1)

def loss_fn(out, heat, reg, mask):
    p = out[:, :1].clamp(1e-4, 1 - 1e-4)
    pos = heat.eq(1).float(); neg = 1 - pos
    focal = -(pos * (1 - p) ** 2 * torch.log(p) + neg * (1 - heat) ** 4 * p ** 2 * torch.log(1 - p)).sum() / pos.sum().clamp(min=1)
    m = (mask > 0).float(); n = m.sum().clamp(min=1)
    l_off = (F.l1_loss(out[:, 1:3], reg[:, 0:2], reduction='none') * m).sum() / n
    l_size = (F.l1_loss(out[:, 3:5], reg[:, 2:4], reduction='none') * m).sum() / n
    l_ang = (F.l1_loss(out[:, 5:7], reg[:, 4:6], reduction='none') * mask).sum() / n
    return focal + l_off + l_size + 0.5 * l_ang, (focal.item(), l_off.item(), l_size.item(), l_ang.item())

def decode(out, thr=0.3):
    """Plates found in one output [7, H, W]: peaks of the heatmap (3 x 3 maxima) over thr."""
    heat = out[0:1][None]; keep = (F.max_pool2d(heat, 3, 1, 1) == heat)[0, 0] & (out[0] > thr)
    res = []
    for iy, ix in zip(*torch.nonzero(keep, as_tuple=True)):
        v = out[:, iy, ix]
        res.append(dict(score=v[0].item(), cx=(ix.item() + v[1].item()) * STRIDE, cy=(iy.item() + v[2].item()) * STRIDE,
                        a=math.exp(v[3].item()) * STRIDE, b=math.exp(v[4].item()) * STRIDE, phi=0.5 * math.atan2(v[6].item(), v[5].item())))
    return res

def evaluate(model, imgs, labels, dev):
    """Recall of the main plates (centre within a fifth of its size, size within 20 %) and false finds per picture."""
    model.eval(); hit = tot = false = 0
    with torch.no_grad():
        for i in range(0, len(imgs), 64):
            x = torch.from_numpy(((imgs[i:i + 64].astype(np.float32) / 255 - 0.5) / 0.25)[:, None]).to(dev)
            outs = model(x).cpu()
            for k, o in enumerate(outs):
                found, ls = decode(o), labels[i + k]
                matched = set()
                for l in ls:
                    tot += 1
                    for j, f in enumerate(found):
                        if j not in matched and math.hypot(f['cx'] - l['cx'], f['cy'] - l['cy']) < 0.2 * l['a'] + 2 and abs(f['a'] / l['a'] - 1) < 0.2:
                            hit += 1; matched.add(j); break
                false += len(found) - len(matched)
    model.train()
    return hit / max(1, tot), false / len(imgs)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--data', default='data'); ap.add_argument('--epochs', type=int, default=30)
    ap.add_argument('--batch', type=int, default=64); ap.add_argument('--out', default='plate-detector.onnx')
    a = ap.parse_args()
    imgs, labels = load(a.data)
    nval = max(200, len(imgs) // 20)
    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f'{len(imgs)} pictures ({nval} held out), {sum(map(len, labels))} plates, training on {dev}')
    tr = torch.utils.data.DataLoader(Plates(imgs[nval:], labels[nval:], True), batch_size=a.batch, shuffle=True, num_workers=2, drop_last=True)
    model = Net().to(dev)
    print(f'{sum(p.numel() for p in model.parameters()) / 1e6:.2f} M parameters')
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=a.epochs * len(tr))
    scaler = torch.cuda.amp.GradScaler(enabled=dev == 'cuda')
    for ep in range(a.epochs):
        t0, tot = time.time(), 0
        for x, heat, reg, mask in tr:
            x, heat, reg, mask = x.to(dev), heat.to(dev), reg.to(dev), mask.to(dev)
            with torch.autocast(dev, enabled=dev == 'cuda'):
                out = model(x)
            loss, parts = loss_fn(out.float(), heat, reg, mask)
            opt.zero_grad(); scaler.scale(loss).backward(); scaler.step(opt); scaler.update(); sched.step()
            tot += loss.item()
        if ep % 5 == 4 or ep == a.epochs - 1:
            rec, fp = evaluate(model, imgs[:nval], labels[:nval], dev)
            print(f'epoch {ep + 1}: loss {tot / len(tr):.3f}, held-out recall {rec:.1%}, false finds {fp:.2f}/picture ({time.time() - t0:.0f} s)')
        else:
            print(f'epoch {ep + 1}: loss {tot / len(tr):.3f} ({time.time() - t0:.0f} s)')
    model.eval().cpu()
    args = (model, torch.zeros(1, 1, S, S), a.out)
    try:  # the classic exporter (needs nothing else); newer PyTorch's default one needs onnxscript
        torch.onnx.export(*args, input_names=['image'], output_names=['maps'], opset_version=17, dynamo=False)
    except TypeError:
        torch.onnx.export(*args, input_names=['image'], output_names=['maps'], opset_version=17)
    print(f'saved {a.out} ({os.path.getsize(a.out) / 1e6:.1f} MB)')
    try:  # the same numbers from the exported file
        import onnxruntime as ort
        x = np.zeros((1, 1, S, S), np.float32)
        d = np.abs(ort.InferenceSession(a.out).run(None, {'image': x})[0] - model(torch.from_numpy(x)).detach().numpy()).max()
        print(f'ONNX check: max difference {d:.2e}')
    except ImportError:
        pass

if __name__ == '__main__':
    main()
