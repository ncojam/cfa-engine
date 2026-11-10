#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include <algorithm>
#include <stdint.h>

// Portable replacement for the Windows BMP structures that used to come
// from <windows.h>. Only the fields actually used by this tool are needed.
#pragma pack(push, 1)
struct BITMAPFILEHEADER
{
	uint16_t bfType;
	uint32_t bfSize;
	uint16_t bfReserved1;
	uint16_t bfReserved2;
	uint32_t bfOffBits;
};

struct BITMAPINFOHEADER
{
	uint32_t biSize;
	int32_t  biWidth;
	int32_t  biHeight;
	uint16_t biPlanes;
	uint16_t biBitCount;
	uint32_t biCompression;
	uint32_t biSizeImage;
	int32_t  biXPelsPerMeter;
	int32_t  biYPelsPerMeter;
	uint32_t biClrUsed;
	uint32_t biClrImportant;
};
#pragma pack(pop)

// Ширина, высота и размер в байтах тайлов в GBA
const int tileWidth = 8;
const int tileHeight = 8;
const int tileSize = tileWidth * tileHeight;

// Представление 16-битного цвета в GBA (полноцветные режимы или палитра)
#define GBA_RGB(r,g,b)  ((r)+((g)<<5)+((b)<<10)) 

// Цвет пикселя в 24-битном формате BMP
struct PalRGB
{
	unsigned char b, g, r;
};

PalRGB pal[ 256 ] = {0};	// Текущая палитра использованных цветов
int firstPal = 0;
int palsize = 0;	// Количество использованных цветов палитры

// Сравнение цветовых компонент 24-битной палитры на равенство.
// Так как в GBA цвет упакован в 16-бит в формате 5:5:5, то
// нижние 3 бита 8-битных компонент просто потеряются и мы их откидываем.
inline bool ColorCompEqual( unsigned int a, unsigned int b )
{
	return (a >> 3) == (b >> 3);
};

// 
int GetPalIndex( unsigned int r, unsigned int g, unsigned int b )
{
	// search existing...
	int res = -1;
	for ( int i = firstPal; i < palsize; i++ )
	{
		if (	ColorCompEqual( pal[ i ].r, r ) && 
			ColorCompEqual( pal[ i ].g, g ) &&
			ColorCompEqual( pal[ i ].b, b ) )
		{
			if( i == firstPal ){ res = 0;}
			else{ res = i; }
			break;
		};
	};
	if ( (res == -1) && (palsize < 256) )
	{
		pal[ palsize ].r = r;
		pal[ palsize ].g = g;
		pal[ palsize ].b = b;
		res = palsize;
		palsize++;
	};
	return res;
};

struct TileDesc
{
	short int index;
	short int orient;
	short int used;
	short int optIndex;
};

int tileCompareOrient( unsigned char *a, unsigned char *b, int orient )
{
	int tx, ty;
	for ( int y = 0; y < tileHeight; y++ )
	{
		for ( int x = 0; x < tileWidth; x++ )
		{
			tx = (orient & 1) ? (tileWidth - 1 - x) : x;
			ty = (orient & 2) ? (tileHeight - 1 - y) : y;
			if ( a[ x + tileWidth * y ] != b[ tx + tileWidth * ty ] )
			{
				return -1;
			};
		};
	};
	return orient;
};

int tileCompare( unsigned char *a, unsigned char *b )
{
	for ( int i = 0; i <= 3; i++ )
	{
		if ( tileCompareOrient( a, b, i ) != -1 )
			return i;
	};
	return -1;
};

std::string trim(const std::string& str,
                 const std::string& whitespace = " \t\r\n")
{
    const auto strBegin = str.find_first_not_of(whitespace);
    if (strBegin == std::string::npos)
        return ""; // no content

    const auto strEnd = str.find_last_not_of(whitespace);
    const auto strRange = strEnd - strBegin + 1;

    return str.substr(strBegin, strRange);
};

std::string extractStr( const std::string &str, const std::string &key )
{
	std::string res = "";
	size_t first = str.find( key + "=\"" );
	if ( first != std::string::npos )
	{
		first += (key.size() + 2);
		size_t last = str.find( "\"", first );
		if ( last != std::string::npos )
		{
			res = str.substr( first, last - first );
		};
	};
	return res;
};

bool strBeginsWith( const std::string &s, const char *pattern )
{
	int len = strlen( pattern );
	if ( s.length() < len ) return false;
	return (memcmp( s.c_str(), pattern, len ) == 0);
};

bool strEndsWith( const std::string &s, const char *pattern )
{
	int len = strlen( pattern );
	if ( s.length() < len ) return false;
	return (memcmp( s.c_str() + s.length() - len, pattern, len ) == 0);
};

enum TMXParseMode
{
	TMXPM_Scan,
	TMXPM_Map,
	TMXPM_MapData,
	TMXPM_Objects,
	TMXPM_ObjectsData
};

int main( int argc, char *argv[] )
{
	BITMAPFILEHEADER bfh;
	BITMAPINFOHEADER bih;
	std::vector<unsigned char> tiles;
	std::vector<unsigned char> optTiles;
	std::vector<unsigned char> bitmap;
	std::vector<PalRGB> scanline;
	std::vector<TileDesc> tileDesc;
	int tmw, tmh, tcount, optcount;
	int scanwidth, r, maxused, maxusedi;
	unsigned char *ptr;
	std::string fname, s, st, st2;
	std::string tmname;
	char c, *cptr;
	FILE *f = NULL, *fout = NULL;
	bool in_map = false;
	int d, pos;
	bool process_bmp = false;
	bool process_tmx = false;
	bool compress_tiles = false;
	bool unless = false;//unless it's wardrobe
	bool is_portrait = false;
	std::string bmpfile = "";
	std::string tmxfile = "";
	std::string resname = "out";
	int min_argc = 3;
	TMXParseMode mode;

	if ( argc < min_argc )
		goto show_usage;

	bmpfile = argv[ 2 ];

	cptr = argv[ 1 ];
	while ( *cptr )
	{
		if ( *cptr == 'b' )
		{
			process_bmp = true;
		}
		else if ( *cptr == 'c' )
		{
			compress_tiles = true;
		}
		else if ( *cptr == 'u' )
		{
			unless = true;
		}
		else if ( *cptr == 'p' )
		{
			is_portrait = true;
		}
		else if ( *cptr == 't' )
		{
			process_tmx = true;
			min_argc = 4;
		}
		else
		{
			goto show_usage;
		};
		cptr++;
	};
	
	if( is_portrait ){ firstPal = 224; palsize = 224;}
	else{ firstPal = 0; palsize = 0;}

	if ( argc < min_argc )
		goto show_usage;

	if ( process_tmx )
		tmxfile = argv[ 3 ];

	if ( argc > min_argc )
		resname = argv[ min_argc ];

	printf( "process_bmp: %d, process_tmx: %d, compress_tiles: %d, bmp file: %s, tmx file: %s, out name: %s.\n", 
		process_bmp, process_tmx, compress_tiles, bmpfile.c_str(), tmxfile.c_str(), resname.c_str() );

	if ( !process_bmp )
	{
		goto show_usage;
	};

	memset( pal, 0, sizeof( pal ) );

	// PROCESS BMP	

	f = fopen( bmpfile.c_str(), "rb" );
	if ( !f )
	{
		printf( "Cannot open file with name '%s'!\n", bmpfile.c_str() );
		goto quit;
	};

	fread( &bfh, 1, sizeof( bfh ), f );
	fread( &bih, 1, sizeof( bih ), f );

	//printf( "Info:\nMagic: %x\nBitmap offset: %i\n", bfh.bfType, bfh.bfOffBits );
	printf( "Bitmap width: %i, height: %i.\n", bih.biWidth, bih.biHeight );
	//printf( "bpp: %i\ncompression: %i\n", bih.biBitCount, bih.biCompression );

	if ( bfh.bfType != 0x4D42 )
	{
		printf( "Error: wrong BMP header!\n" );
		goto quit;
	};
	if ( bih.biBitCount != 24 )
	{
		printf( "Error: BPP must be 24 bits per pixel!\n" );
		goto quit;
	};
	if ( bih.biCompression != 0 )
	{
		printf( "Error: there must be no compression!\n" );
		goto quit;
	};
	if ( (bih.biWidth % tileWidth != 0) || ( bih.biHeight % tileHeight != 0) )
	{
		printf( "Error: width and height must be divisible by tile sizes!\n" );
		goto quit;
	};
	tmw = bih.biWidth / tileWidth;
	tmh = bih.biHeight / tileHeight;
	tcount = tmw * tmh;
	scanwidth = bih.biWidth * 3;
	while ( scanwidth % 4 != 0 )
		scanwidth++;

	tiles.resize( tmw * tmh * tileSize );
	tileDesc.resize( tcount );
	bitmap.resize( bih.biWidth * bih.biHeight );
	scanline.resize( bih.biWidth );

	for ( int y = 0; y < bih.biHeight; y++ )
	{
		fseek( f, bfh.bfOffBits + scanwidth * (bih.biHeight - y - 1), SEEK_SET );
		fread( &scanline[ 0 ], sizeof( PalRGB ), bih.biWidth, f );
		for ( int x = 0; x < bih.biWidth; x++ )
		{
			r = GetPalIndex( scanline[ x ].r, scanline[ x ].g, scanline[ x ].b );
			if ( r < 0 )
			{
				printf( "Error: more than 256 color processed!\n" );
				goto quit;
			};
			bitmap[ x + y * bih.biWidth ] = r;
		};
	};
	printf( "Processed pal size: %i.\n", palsize );

	fclose( f );
	f = NULL;

	ptr = &tiles[ 0 ];
	for ( int y = 0; y < tmh; y++ )
	{
		for ( int x = 0; x < tmw; x++ )
		{
			for ( int ty = 0; ty < tileHeight; ty++ )
			{
				for ( int tx = 0; tx < tileWidth; tx++ )
				{
					*ptr++ = bitmap[ (tileWidth * x + tx) + (tileHeight * y + ty) * bih.biWidth ];
				};
			};
		};
	};
	bitmap.resize( 0 );

	optcount = 0;
	// Calculate descriptions...
	for ( int i = 0; i < tcount; i++ )
	{
		tileDesc[ i ].index = i;
		tileDesc[ i ].orient = 0;
		tileDesc[ i ].used = 1;
		optcount++;
		if ( compress_tiles )
		{
			int kk = i;
			//if( unless ){ kk = 835; }
			for ( int j = 0; j < kk; j++ )
			{
				r = tileCompare( &tiles[ kk * tileSize ], &tiles[ j * tileSize ] );
				if ( r >= 0 )
				{
					if( !unless || ( unless && kk < 960 )){
					tileDesc[ kk ].index = j;
					tileDesc[ kk ].orient = r; // futher...
					tileDesc[ kk ].used = 0; // no in use

					tileDesc[ j ].used++;
					optcount--;
					break;
					}
				};
			};
		};
	};
	optTiles.resize( optcount * tileSize );
	r = 0;
	for ( int i = 0; i < tcount; i++ )
	{
		TileDesc &td = tileDesc[ i ];
		if ( td.index == i )
		{
			memcpy( &optTiles[ r * tileSize ], &tiles[ i * tileSize ], tileSize );
			td.optIndex = r++;
		}
		else
		{
			td.optIndex = tileDesc[ td.index ].optIndex;
		};
	};

	if ( compress_tiles )
	{
		printf( "Total count of tiles: %i, after optimization: %i.\n", tcount, optcount );
	}
	else
	{
		printf( "Total count of tiles: %i.\n", optcount );
	};

	// OUTPUT PALETTE

	fname = resname + ".pal.inc";
	f = fopen( fname.c_str(), "wt" );
	if ( !f )
	{
		printf( "Cannot create file with name '%s'!\n", fname.c_str() );
		goto quit;
	};
	fprintf( f, "const int %s_pal_size = %i;\n", resname.c_str(), palsize );
	fprintf( f, "const unsigned short %s_pal[] = {\n", resname.c_str() );
	for ( int i = 0; i < palsize; i++ )
	{
		if ( (i > 0) && (i % 8 == 0) )
			fputs( "\n", f );
		fprintf( f, "%u", GBA_RGB( (pal[ i ].r >> 3), (pal[ i ].g >> 3), (pal[ i ].b >> 3) ) );
		if ( i != palsize - 1 )
			fputs( ", ", f );
	};
	fprintf( f, " };\n\n" );

	fclose( f );
	f = NULL;

	// OUTPUT TILES

	fname = resname + ".til.inc";
	f = fopen( fname.c_str(), "wt" );
	if ( !f )
	{
		printf( "Cannot create file with name '%s'!\n", fname.c_str() );
		goto quit;
	};
	if ( compress_tiles )
	{
		fprintf( f, "const int %s_opt_size = %i;\n", resname.c_str(), tcount );
		fprintf( f, "const unsigned short %s_opt[] = {\n", resname.c_str() );
		for ( int i = 0; i < tcount; i++ )
		{
			TileDesc &td = tileDesc[ i ];
			if ( (i > 0) && (i % 16 == 0) )
				fputs( "\n", f );
			fprintf( f, "%u", td.optIndex | (td.orient << 10) );
			if ( i != tcount - 1 )
				fputs( ", ", f );
		};
		fprintf( f, " };\n\n" );
	};

	fprintf( f, "const int %s_til_size = %i;\n", resname.c_str(), optcount );
	fprintf( f, "const unsigned char %s_til[] = {\n", resname.c_str() );
	for ( int i = 0; i < optcount; i++ )
	{
		fprintf( f, "// tile %i\n", i );
		for ( int y = 0; y < tileHeight; y++ )
		{
			for ( int x = 0; x < tileWidth; x++ )
			{
				fprintf( f, "%i", optTiles[ i * tileSize + x + y * tileWidth ] );
				if ( !((i == optcount - 1) && (y == tileHeight -1) && (x == tileWidth - 1)) )
					fputs( ",", f );
			};
			fputs( "\n", f );
		};
	};
	fprintf( f, " };\n\n" );

	fclose( f );
	f = NULL;

	// PROCESS TMX
	if ( !process_tmx )
		goto quit;

	f = fopen( tmxfile.c_str(), "rb" );
	if ( !f )
	{
		printf( "Cannot open file with name '%s'!\n", tmxfile.c_str() );
		goto quit;
	};
	mode = TMXPM_Scan;
	while ( true )
	{
		s = "";
		while ( (r = fgetc( f )) != EOF )
		{
			if ( r == '\n' )
				break;
			s = s + (char) r;
		};
		s = trim( s );
		switch ( mode )
		{
		case TMXPM_Scan:
			if ( strBeginsWith( s, "<layer " ) )
			{
				tmname = extractStr( s, std::string( "name" ) );
				st = extractStr( s, std::string( "width" ) );
				tmw = atoi( st.c_str() );
				st = extractStr( s, std::string( "height" ) );
				tmh = atoi( st.c_str() );
				printf( "Found map: %s, width: %i, height: %i.\n", tmname.c_str(), tmw, tmh );

				fname = tmname + ".inc";
				fout = fopen( fname.c_str(), "wt" );
				if ( !fout )
				{
					printf( "Cannot create file with name '%s'!\n", fname.c_str() );
					goto quit;
				};
				fprintf( fout, "const int %s_width = %i;\n", tmname.c_str(), tmw );
				fprintf( fout, "const int %s_height = %i;\n", tmname.c_str(), tmh );
				fprintf( fout, "const unsigned short %s[] = {\n", tmname.c_str() );
				mode = TMXPM_Map;
			}
			else if ( strBeginsWith( s, "<objectgroup" ) )
			{
				tmname = extractStr( s, std::string( "name" ) );
				printf( "Found object group: %s.\n", tmname.c_str(), tmw, tmh );

				fname = tmname + ".inc";
				fout = fopen( fname.c_str(), "wt" );
				if ( !fout )
				{
					printf( "Cannot create file with name '%s'!\n", fname.c_str() );
					goto quit;
				};
				fprintf( fout, "const char * const %s[] = {\n", tmname.c_str() );
				mode = TMXPM_Objects;
			};
			break;
		case TMXPM_Map:
			if ( strBeginsWith( s, "<data " ) )
			{
				mode = TMXPM_MapData;
			};
			break;
		case TMXPM_MapData:
			if ( strBeginsWith( s, "</data>" ) )
			{
				mode = TMXPM_Scan;
				fprintf( fout, " };\n\n" );

				fclose( fout );
				fout = NULL;
				break;
			};
			// process line...
			r = 0;
			pos = 0;
			while ( pos < s.size() )
			{
				if ( (r != 0) && (r != tmw - 1) && (r % 16 == 0) )
					fputs( "\n", fout );

				d = atoi( &s[ pos ] );
				if ( d )
					// fprintf( fout, "%i", (tileDesc[ d - 1 ].optIndex) | (tileDesc[ d - 1 ].orient << 10) ); // optimized
					fprintf( fout, "%i", d - 1 );
				else
					fprintf( fout, "%i", 0 );
				pos = s.find( ",", pos );
				if ( pos == std::string::npos )
				{
				}
				else
				{
					fputs( ",", fout );
					pos++;
				};
				r++;
			};
			fputs( "\n", fout );
			break;
		case TMXPM_Objects:
			if ( strBeginsWith( s, "</objectgroup>" ) )
			{
				mode = TMXPM_Scan;
				fprintf( fout, "nullptr };\n\n" );

				fclose( fout );
				fout = NULL;
			}
			else if ( strBeginsWith( s, "<object " ) )
			{
				st = extractStr( s, std::string( "type" ) );
				fprintf( fout, "\"type\", \"%s\",\n", st.c_str() );
				st = extractStr( s, std::string( "name" ) );
				fprintf( fout, "\"name\", \"%s\",\n", st.c_str() );

				st = extractStr( s, std::string( "x" ) );
				fprintf( fout, "\"x\", \"%s\",\n", st.c_str() );
				st = extractStr( s, std::string( "y" ) );
				fprintf( fout, "\"y\", \"%s\",\n", st.c_str() );

				st = extractStr( s, std::string( "width" ) );
				fprintf( fout, "\"width\", \"%s\",\n", st.c_str() );
				st = extractStr( s, std::string( "height" ) );
				fprintf( fout, "\"height\", \"%s\",\n", st.c_str() );

				if ( strEndsWith( s, "/>" ) )
				{	
					fprintf( fout, "nullptr,\n" );
				}
				else
				{
					mode = TMXPM_ObjectsData;
				};
			};
			break;
		case TMXPM_ObjectsData:
			if ( strBeginsWith( s, "</object>" ) )
			{
				fprintf( fout, "nullptr,\n" );

				mode = TMXPM_Objects;
				break;
			}
			else if ( strBeginsWith( s, "<property" ) )
			{
				st = extractStr( s, std::string( "name" ) );
				fprintf( fout, "\"%s\", ", st.c_str() );
				st = extractStr( s, std::string( "value" ) );
				fprintf( fout, "\"%s\",\n", st.c_str() );
			};
			break;
		};
		if ( feof( f ) )
			break;
	};

	fclose( f );
	f = NULL;
	if ( fout )
	{
		fclose( fout );
		fout = NULL;
	};

	goto quit;

show_usage:
	printf( "Usage: 1) tmx2incl.exe OPER bmpfile.bmp [tmxfile.tmx [outname]]\n" );
	printf( "          where OPER consists of next characters:\n" );
	printf( "          b - process BMP (required!),\n" );
	printf( "          c - compress tile information and produce 'opt' array,\n" );
	printf( "          t - process TMX (tmx file name must be provided!).\n" );
	printf( "\n" );
	printf( "Example: tmx2incl.exe bct example.bmp example.tmx example\n" );

quit:
	if ( f )
	{
		fclose( f );
		f = NULL;
	};
	if ( fout )
	{
		fclose( fout );
		fout = NULL;
	};
	return 0;
};