OUTPUT_DIR=./build
EMCC_OPTS=-O3 --memory-init-file 0 --closure 1 -s NO_FILESYSTEM=1 -s MODULARIZE=1
EXPORTS:='_free','_malloc','_celt_strerror','_celt_encoder_create','_celt_encode','_celt_encode_float','_celt_encoder_ctl','_celt_encoder_destroy','_celt_decoder_create','_celt_decode','_celt_decode_float','_celt_decoder_ctl','_celt_decoder_destroy','_celt_mode_create','_celt_mode_destroy','_celt_mode_info'

CELT_ALPHA=tags/v0.7.1
CELT_DIR=./celt
CELT_OBJ=$(CELT_DIR)/libcelt/.libs/libcelt0.a

POST_JS=./lib/post.js
CELT_JS=$(OUTPUT_DIR)/libcelt7.js

default: $(CELT_JS)

clean:
	rm -rf $(OUTPUT_DIR) $(CELT_DIR)
	mkdir $(OUTPUT_DIR)

.PHONY: clean default

$(CELT_DIR):
	git submodule update --init --recursive
	cd $(CELT_DIR); git checkout ${CELT_ALPHA}

$(CELT_OBJ): $(CELT_DIR)
	# There seems to be some invalid syntax in the autoconf file, so we delete that line
	# Note: this will cause the makefile to fail if executed twice (which shouldn't be necessary)
	sed -i -e '73d' $(CELT_DIR)/configure.ac
	cd $(CELT_DIR); ./autogen.sh
	cd $(CELT_DIR); emconfigure ./configure
	cd $(CELT_DIR); emmake make

$(CELT_JS): $(CELT_OBJ) $(POST_JS)
	emcc -o $@ $(EMCC_OPTS) -s EXPORTED_FUNCTIONS="[$(EXPORTS)]" $(CELT_OBJ)
	cat $(POST_JS) >> $(CELT_JS)
	# So, there is a bug in static-module (used by brfs) which causes it to fail
	# when trying to parse our generated output for the require('fs') calls
	# Because we won't be using the file system anyway, we monkey patch that call
	sed -i'' 's/require("fs")/null/g' $(CELT_JS)
