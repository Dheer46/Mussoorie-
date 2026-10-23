import sys, re, json, requests, fsspec, pyarrow.parquet as pq, pyarrow as pa
from concurrent.futures import ThreadPoolExecutor
REL="release/2026-10-21.0"; BASE="https://overturemaps-us-west-2.s3.amazonaws.com/"
W,S,E,N = 77.94, 30.37, 78.26, 30.54
def keys(t):
    out=[]; tok=None
    while True:
        u=BASE+f"?list-type=2&prefix={REL}/{t}/"+(f"&continuation-token={requests.utils.quote(tok)}" if tok else "")
        x=requests.get(u).text; out+=re.findall(r'<Key>([^<]*)',x)
        m=re.search(r'<NextContinuationToken>([^<]*)',x)
        if not m: return out
        tok=m.group(1)
fs=fsspec.filesystem("https")
def rgs(k):
    f=pq.ParquetFile(fs.open(BASE+k,block_size=2**20))
    md=f.metadata; names=f.schema_arrow.names
    sch=f.schema; cols={sch.column(i).path:i for i in range(len(sch))}
    hit=[]
    for r in range(md.num_row_groups):
        g=md.row_group(r)
        st=lambda p: g.column(cols[p]).statistics
        try:
            xmin=st('bbox.xmin'); xmax=st('bbox.xmax'); ymin=st('bbox.ymin'); ymax=st('bbox.ymax')
            if xmin.min>E or xmax.max<W or ymin.min>N or ymax.max<S: continue
        except Exception as e: pass
        hit.append(r)
    return k,hit
t=sys.argv[1]; out=sys.argv[2]; colsel=sys.argv[3].split(',')
ks=[k for k in keys(t) if k.endswith('.parquet')]
with ThreadPoolExecutor(16) as ex: res=list(ex.map(rgs,ks))
tables=[]
for k,hit in res:
    if not hit: continue
    f=pq.ParquetFile(fs.open(BASE+k,block_size=2**22))
    for r in hit:
        tb=f.read_row_group(r,columns=colsel+['bbox'])
        bb=tb.column('bbox').combine_chunks()
        import pyarrow.compute as pc
        m=pc.and_(pc.and_(pc.less_equal(bb.field('xmin'),E),pc.greater_equal(bb.field('xmax'),W)),pc.and_(pc.less_equal(bb.field('ymin'),N),pc.greater_equal(bb.field('ymax'),S)))
        tb=tb.filter(m)
        if tb.num_rows: tables.append(tb)
    print(k, hit, file=sys.stderr)
T=pa.concat_tables(tables) if tables else None
pq.write_table(T,out); print(t, T.num_rows)
