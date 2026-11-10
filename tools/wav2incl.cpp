#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include <algorithm>
#include <string>

void mksp( int sp )
{
	for ( int i = 0; i < sp; i++ )
	{
		putchar( ' ' );
	};
};

void dump_riff( FILE *f, char *name, unsigned int pos, unsigned int size, int level )
{
	mksp( 4 * level );
	if ( pos )
	{
		printf( "%s SIZE: %u\n", name, size );
	}
	else
	{
		printf( "BLOCK: %s SIZE: %u\n", name, size );
	};
};

typedef void (*riff_callback)( FILE *f, char *name, unsigned int pos, unsigned int size, int level );

unsigned int enum_riff_chunks( FILE *f, int level, unsigned int pos, riff_callback callback )
{
	char name[ 5 ], lname[ 5 ];
	unsigned int size, psize, subsize;

	fseek( f, pos, SEEK_SET );
	fread( &name, 4, 1, f );
	name[ 4 ] = 0;
	fread( &size, 4, 1, f );
	psize = (size & 1) ? size + 1 : size; // padded size

	if ( (strcmp( name, "RIFF" ) == 0) || (strcmp( name, "LIST" ) == 0) )
	{
		fread( &lname, 4, 1, f );
		lname[ 4 ] = 0;

		callback( f, lname, 0, size, level );

		subsize = 0;
		while ( subsize < psize - 4 )
		{
			subsize += enum_riff_chunks( f, level + 1, pos + 12 + subsize, callback );
		};
	}
	else
	{
		callback( f, name, pos + 8, size, level );
	};
	return psize + 8;
};

std::vector<short int> wavdata;

void read_wave( FILE *f, char *name, unsigned int pos, unsigned int size, int level )
{
	if ( pos && (strcmp( name, "data" ) == 0) )
	{
		printf( "FOUND WAVE DATA AT %u SIZE: %u\n", pos, size );
		wavdata.resize( size / 2 );
		fread( &wavdata[ 0 ], size, 1, f );
	}
	else
	{
		//printf( "Ignoring %s section at %u with size %u...\n", name, pos, size );
	};
};

int main( int argc, char *argv[] )
{
	if ( argc <= 2 )
	{
		printf( "Usage: wav2incl.exe input.wav [+]output wavname\n" );
		return 0;
	};
	FILE *f = fopen( argv[ 1 ], "rb" );
	if ( f )
	{
		enum_riff_chunks( f, 0, 0, dump_riff );
		enum_riff_chunks( f, 0, 0, read_wave );
		fclose( f );
		// write it to output file...
		
		std::string outname = argv[ 2 ];
		const char *mode = "wt";
		if ( outname[ 0 ] == '+' )
		{
			outname = argv[ 2 ] + 1;
			mode = "at";
		};

		f = fopen( outname.c_str(), mode );
		if ( f )
		{
			int xmax = 0, xmin = 0;
			const char *wavname = "wavname";
			if ( argc >= 4 )
			{
				wavname = argv[ 3 ];
			};
			fprintf( f, "const int %s_size = %i;\n", wavname, wavdata.size() );
			fprintf( f, "const unsigned int %s[] = {", wavname );
			for ( int i = 0; i < wavdata.size(); i += 4 )
			{
				if ( i ) fputs( ",", f );
				if ( (i % (4 * 8)) == 0 ) fputs( "\n", f );
				unsigned int data = 0;
				for ( int j = 0; j < 4; j++ )
				{
					int xr = wavdata[ (i + j < wavdata.size()) ? (i + j) : (wavdata.size() - 1) ];
					//printf( "wavdata[%i]=%i\n", i + j, xr );
					signed char x = xr / 256;
					xmax = std::max( (int)x, xmax );
					xmin = std::min( (int)x, xmin );
					data = (data >> 8) | (x << 24);
				};
				fprintf( f, "0x%x", data );
			};
			fputs( "};\n\n", f );
			fclose( f );
			printf( "Processed %u samples, min: %i max: %i.\n", wavdata.size(), xmin, xmax );
		}
		else
		{
			printf( "Cannot create file with name '%s'!\n", argv[ 2 ] );
		};
	}
	else
	{
		printf( "Cannot open file with name '%s'!\n", argv[ 1 ] );
	};
	return 0;
};