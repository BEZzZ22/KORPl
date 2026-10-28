import sys, glob
from PIL import Image
d=sys.argv[1]; fs=sorted(glob.glob(d+'/stills/t*.png'), key=lambda f: float(f.split('/t')[-1].split('_')[0]))
w,h=270,480; cols=7
im=Image.new('RGB',(w*cols,h*((len(fs)+cols-1)//cols)),'gray')
for i,f in enumerate(fs): im.paste(Image.open(f).convert('RGB').resize((w,h)),((i%cols)*w,(i//cols)*h))
im.save(d+'/sheet.png')
