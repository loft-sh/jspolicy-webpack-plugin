import webpack from 'webpack';
import path from 'path';
import yaml from 'yaml';
import { promises as fs, existsSync } from 'fs';
import { PolicyV1beta1JsPolicy, PolicyV1beta1JsPolicyBundle } from '@jspolicy/types'

interface PolicyBundleOptions {
    outDir: string
    srcDir: string
    tsOutDir: string
    policyNameRegex: RegExp
    policyFileName: string
}

export class PolicyBundlePlugin {
    options: PolicyBundleOptions = {
        outDir: "./policies",
        srcDir: "./src",
        tsOutDir: "./dist",
        policyNameRegex: /.*\/policies\/(.*)\/.*\.js/,
        policyFileName: "policy.yaml",
    };

    constructor(options: PolicyBundleOptions) {
        this.options = Object.assign(this.options, options)
    }
    
    async writePolicyManifest(bundleFile: string) {
        const sourceFolder = path.dirname(bundleFile).replace(this.options.tsOutDir, this.options.srcDir)
        const policySourceFile = sourceFolder + "/" + this.options.policyFileName
        if (existsSync(policySourceFile) === false) {
            return
        }

        const policyName = bundleFile.replace(this.options.policyNameRegex, "$1")
        const outFilePolicy = this.options.outDir + "/" + policyName + ".yaml"

        await fs.mkdir(path.dirname(outFilePolicy), {recursive: true})

        const policyYaml = await fs.readFile(policySourceFile, 'utf8')
        const policy: PolicyV1beta1JsPolicy = yaml.parse(policyYaml)
        const policyBundle: PolicyV1beta1JsPolicyBundle = {
            apiVersion: policy.apiVersion,
            kind: "JsPolicyBundle",
            metadata: policy.metadata,
            spec: {
                bundle: Buffer.from(await fs.readFile(bundleFile)).toString("base64")
            }
        }

        const policyBundleYaml = yaml.stringify(policyBundle)

        await fs.copyFile(policySourceFile, outFilePolicy)
    
        return fs.appendFile(outFilePolicy, "\n---\n" + policyBundleYaml)
    }

    apply(compiler: webpack.Compiler) {
        compiler.hooks.afterEmit.tap('PolicyBundlePlugin',
            async (compilation: webpack.Compilation) => {
                const delPromises: Promise<any>[] = [];
                (await fs.readdir(this.options.outDir)).forEach(async (file: string) => {
                    file = this.options.outDir + "/" + file
                    if ((await fs.stat(file)).isDirectory()) {
                        delPromises.push(fs.rmdir(file, {recursive: true}))
                    } else {
                        delPromises.push(fs.unlink(file))
                    }
                })

                await Promise.all(delPromises)

                const promises: Promise<any>[] = []
                
                compilation.getAssets().forEach((asset) => {
                    promises.push(this.writePolicyManifest(asset.name))
                })
                return Promise.all(promises)
            }
        );
    }
}